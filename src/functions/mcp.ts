import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../lib/server.js";

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

async function mcpHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createMcpServer();
    transport.onerror = (error) => context.error("MCP transport error:", error);

    await server.connect(transport);

    const response = await transport.handleRequest(await toWebRequest(request));

    await server.close();
    await transport.close();

    return toAzureResponse(response);
  } catch (err: any) {
    context.error("MCP handler error:", err);
    return {
      status: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: err.message ?? "Internal error" },
        id: null,
      }),
    };
  }
}

app.http("mcp", {
  methods: ["GET", "POST", "DELETE"],
  authLevel: "function",
  route: "mcp",
  handler: mcpHandler,
});
