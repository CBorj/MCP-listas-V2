import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../lib/server.js";

// ── Read-only tools (served via GET, no confirmation in ChatGPT) ──

const readOnlyTools = new Set([
  "storage.inspect",
  "table.list",
  "table.read",
  "table.exists",
  "table.head",
  "table.query",
  "table.scanPartition",
  "table.queryByPrefix",
  "table.get_entity",
  "container.list",
  "container.exists",
  "container.head",
  "blob.list",
  "blob.download",
  "blob.exists",
  "blob.head",
  "blob.getProperties",
]);

// ── Azure Function handler ─────────────────────────────────────

async function toWebRequest(request: HttpRequest): Promise<Request> {
  const headers = new Headers(request.headers);
  const init: RequestInit = {
    method: request.method,
    headers,
  };

  if (!["GET", "HEAD", "DELETE"].includes(request.method)) {
    init.body = await request.arrayBuffer();
  }

  return new Request(request.url, init);
}

function toAzureResponse(response: Response): HttpResponseInit {
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: response.body ?? undefined,
  };
}

function jsonResponse(status: number, payload: unknown): HttpResponseInit {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

async function handleMcpWebRequest(
  request: Request,
  context: InvocationContext
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createMcpServer();
  transport.onerror = (error) => context.error("MCP transport error:", error);

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await server.close();
    await transport.close();
  }
}

async function invokeInternalMcp(
  method: string,
  params: Record<string, unknown>,
  context: InvocationContext
): Promise<any> {
  const request = new Request("https://internal.local/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  const response = await handleMcpWebRequest(request, context);
  const responseText = await response.text();

  if (!responseText) {
    return {};
  }

  return JSON.parse(responseText);
}

function normalizeInvokeResponse(toolName: string, result: any) {
  const response: Record<string, unknown> = {
    tool: toolName,
    isError: !!result?.isError,
    content: result?.content ?? [],
  };

  if (result?.structuredContent !== undefined) {
    response.structuredContent = result.structuredContent;
  }

  const firstContent = Array.isArray(result?.content) ? result.content[0] : undefined;
  if (firstContent?.type === "text" && typeof firstContent.text === "string") {
    response.text = firstContent.text;

    try {
      const parsed = JSON.parse(firstContent.text);
      response.json = parsed;

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        response.data = parsed;

        if (Array.isArray(parsed.items)) {
          response.items = parsed.items;
          response.itemCount = parsed.items.length;
        }

        if (Array.isArray(parsed.tables)) {
          response.tables = parsed.tables;
          response.tableCount = parsed.tables.length;
        }

        if (Array.isArray(parsed.containers)) {
          response.containers = parsed.containers;
          response.containerCount = parsed.containers.length;
        }
      }
    } catch {
      // Keep text-only output when the content is not JSON.
    }
  }

  return response;
}

async function mcpHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const response = await handleMcpWebRequest(await toWebRequest(request), context);
    return toAzureResponse(response);
  } catch (err: any) {
    context.error("MCP handler error:", err);
    return jsonResponse(500, {
        jsonrpc: "2.0",
        error: { code: -32603, message: err.message ?? "Internal error" },
        id: null,
      });
  }
}

async function mcpToolsHandler(
  _request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const rpcResponse = await invokeInternalMcp("tools/list", {}, context);

    if (rpcResponse?.error) {
      return jsonResponse(500, rpcResponse.error);
    }

    return jsonResponse(200, rpcResponse?.result ?? { tools: [] });
  } catch (err: any) {
    context.error("MCP tools wrapper error:", err);
    return jsonResponse(500, {
      error: "Failed to list tools",
      message: err.message ?? "Internal error",
    });
  }
}

async function mcpInvokeHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const body = (await request.json()) as {
      tool?: string;
      toolName?: string;
      name?: string;
      arguments?: Record<string, unknown>;
      input?: Record<string, unknown>;
      args?: Record<string, unknown>;
      payload?: Record<string, unknown>;
      params?: Record<string, unknown>;
    };
    const toolName = body?.toolName ?? body?.tool ?? body?.name;
    const toolInput =
      body?.input ?? body?.payload ?? body?.params ?? body?.args ?? body?.arguments ?? {};

    if (!toolName) {
      return jsonResponse(400, {
        error: "Missing 'tool'",
        message: "Provide the tool name in the 'tool' field.",
      });
    }

    const rpcResponse = await invokeInternalMcp(
      "tools/call",
      {
        name: toolName,
        arguments: toolInput,
      },
      context
    );

    if (rpcResponse?.error) {
      return jsonResponse(500, rpcResponse.error);
    }

    return jsonResponse(
      rpcResponse?.result?.isError ? 400 : 200,
      normalizeInvokeResponse(toolName, rpcResponse?.result ?? {})
    );
  } catch (err: any) {
    context.error("MCP invoke wrapper error:", err);
    return jsonResponse(500, {
      error: "Failed to invoke tool",
      message: err.message ?? "Internal error",
    });
  }
}

async function mcpQueryHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const toolName = request.query.get("toolName");
    const inputRaw = request.query.get("input");

    if (!toolName) {
      return jsonResponse(400, {
        error: "Missing 'toolName'",
        message: "Provide the tool name as query parameter 'toolName'.",
      });
    }

    if (!readOnlyTools.has(toolName)) {
      return jsonResponse(403, {
        error: "Tool not allowed",
        message: `'${toolName}' is not a read-only tool. Use POST /api/mcp/invoke for write operations.`,
      });
    }

    let toolInput: Record<string, unknown> = {};
    if (inputRaw) {
      try {
        toolInput = JSON.parse(inputRaw);
      } catch {
        return jsonResponse(400, {
          error: "Invalid 'input'",
          message: "The 'input' query parameter must be valid JSON.",
        });
      }
    }

    const rpcResponse = await invokeInternalMcp(
      "tools/call",
      { name: toolName, arguments: toolInput },
      context
    );

    if (rpcResponse?.error) {
      return jsonResponse(500, rpcResponse.error);
    }

    return jsonResponse(
      rpcResponse?.result?.isError ? 400 : 200,
      normalizeInvokeResponse(toolName, rpcResponse?.result ?? {})
    );
  } catch (err: any) {
    context.error("MCP query wrapper error:", err);
    return jsonResponse(500, {
      error: "Failed to query tool",
      message: err.message ?? "Internal error",
    });
  }
}

app.http("mcp", {
  methods: ["GET", "POST", "DELETE"],
  authLevel: "function",
  route: "mcp",
  handler: mcpHandler,
});

app.http("mcpTools", {
  methods: ["GET"],
  authLevel: "function",
  route: "mcp/tools",
  handler: mcpToolsHandler,
});

app.http("mcpQuery", {
  methods: ["GET"],
  authLevel: "function",
  route: "mcp/query",
  handler: mcpQueryHandler,
});

app.http("mcpInvoke", {
  methods: ["POST"],
  authLevel: "function",
  route: "mcp/invoke",
  handler: mcpInvokeHandler,
});
