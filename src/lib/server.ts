import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as tables from "./tables.js";
import * as blobs from "./blobs.js";

const systemContainerPatterns = [
  /^azure-webjobs-/i,
  /^scm-releases$/i,
  /^function-releases$/i,
];

function isSystemContainer(containerName: string): boolean {
  return systemContainerPatterns.some((pattern) => pattern.test(containerName));
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "mcp-listas",
    version: "2.0.0",
  });

  server.tool(
    "storage.inspect",
    "List the current Azure Storage inventory: tables and blob containers, hiding internal Azure Functions containers by default, with optional blob samples per container.",
    {
      includeSystemContainers: z
        .boolean()
        .optional()
        .describe("Include internal Azure Functions and deployment containers"),
      includeBlobSamples: z
        .boolean()
        .optional()
        .describe("Include a small sample of blobs for each container"),
      samplePerContainer: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Maximum blobs to include per container when includeBlobSamples is true"),
    },
    async ({
      includeSystemContainers,
      includeBlobSamples,
      samplePerContainer,
    }) => {
      const tablesList = await tables.listTables();
      const allContainers = await blobs.listContainers();
      const containers = includeSystemContainers
        ? allContainers
        : allContainers.filter((container) => !isSystemContainer(container.name));
      const blobLimit = samplePerContainer ?? 10;

      const inventory = {
        tables: tablesList,
        containers: includeBlobSamples
          ? await Promise.all(
              containers.map(async (container) => ({
                ...container,
                blobs: await blobs.listBlobs(container.name, undefined, blobLimit),
              }))
            )
          : containers,
      };

      return { content: [{ type: "text", text: JSON.stringify(inventory) }] };
    }
  );

  // ── Table tools ──────────────────────────────────────────────

  server.tool(
    "table.create_entity",
    "Create a new entity in an Azure Table. Auto-creates the table if it doesn't exist.",
    {
      tableName: z.string().describe("Table name"),
      entity: z
        .record(z.unknown())
        .describe(
          "Entity object. Must include partitionKey and rowKey as string properties."
        ),
    },
    async ({ tableName, entity }) => {
      const result = await tables.createEntity(tableName, entity);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "table.get_entity",
    "Get a single entity from an Azure Table by partition key and row key.",
    {
      tableName: z.string().describe("Table name"),
      partitionKey: z.string().describe("Partition key of the entity"),
      rowKey: z.string().describe("Row key of the entity"),
    },
    async ({ tableName, partitionKey, rowKey }) => {
      const result = await tables.getEntity(tableName, partitionKey, rowKey);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "table.query",
    "Query entities from an Azure Table with optional OData filter, select and top.",
    {
      tableName: z.string().describe("Table name"),
      filter: z
        .string()
        .optional()
        .describe("OData filter, e.g. \"PartitionKey eq 'myPK'\""),
      select: z
        .array(z.string())
        .optional()
        .describe("Property names to return"),
      top: z.number().optional().describe("Maximum number of results"),
    },
    async ({ tableName, filter, select, top }) => {
      const results = await tables.queryEntities(
        tableName,
        filter,
        select,
        top
      );
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
  );

  server.tool(
    "table.update_entity",
    "Update an entity in an Azure Table (merge or replace).",
    {
      tableName: z.string().describe("Table name"),
      entity: z
        .record(z.unknown())
        .describe(
          "Entity with partitionKey, rowKey and properties to update"
        ),
      mode: z
        .enum(["merge", "replace"])
        .optional()
        .describe("merge (default) keeps unmentioned fields; replace overwrites all"),
    },
    async ({ tableName, entity, mode }) => {
      await tables.updateEntity(tableName, entity, mode ?? "merge");
      return { content: [{ type: "text", text: "Entity updated" }] };
    }
  );

  server.tool(
    "table.delete_entity",
    "Delete an entity from an Azure Table.",
    {
      tableName: z.string().describe("Table name"),
      partitionKey: z.string().describe("Partition key"),
      rowKey: z.string().describe("Row key"),
    },
    async ({ tableName, partitionKey, rowKey }) => {
      await tables.deleteEntity(tableName, partitionKey, rowKey);
      return { content: [{ type: "text", text: "Entity deleted" }] };
    }
  );

  // ── Blob tools ───────────────────────────────────────────────

  server.tool(
    "blob.upload",
    "Upload string content as a blob. Auto-creates container if needed.",
    {
      containerName: z.string().describe("Blob container name"),
      blobName: z.string().describe("Blob name / path"),
      content: z.string().describe("Text content to upload"),
      contentType: z
        .string()
        .optional()
        .describe("MIME type (default: application/octet-stream)"),
    },
    async ({ containerName, blobName, content, contentType }) => {
      const result = await blobs.uploadBlob(
        containerName,
        blobName,
        content,
        contentType
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "blob.download",
    "Download a blob's content as text.",
    {
      containerName: z.string().describe("Blob container name"),
      blobName: z.string().describe("Blob name / path"),
    },
    async ({ containerName, blobName }) => {
      const result = await blobs.downloadBlob(containerName, blobName);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "blob.list",
    "List blobs in a container, optionally filtered by prefix.",
    {
      containerName: z.string().describe("Blob container name"),
      prefix: z.string().optional().describe("Blob name prefix filter"),
    },
    async ({ containerName, prefix }) => {
      const results = await blobs.listBlobs(containerName, prefix);
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
  );

  server.tool(
    "blob.delete",
    "Delete a blob from a container.",
    {
      containerName: z.string().describe("Blob container name"),
      blobName: z.string().describe("Blob name / path"),
    },
    async ({ containerName, blobName }) => {
      await blobs.deleteBlob(containerName, blobName);
      return { content: [{ type: "text", text: "Blob deleted" }] };
    }
  );

  return server;
}
