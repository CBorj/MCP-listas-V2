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

function jsonContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function resolveTableName(tableName?: string): string {
  const resolved = tableName ?? process.env.DEFAULT_TABLE_NAME;

  if (!resolved) {
    throw new Error("Provide table or set DEFAULT_TABLE_NAME env var");
  }

  return resolved;
}

function toTableEntity(input: {
  partitionKey: string;
  rowKey: string;
  properties: Record<string, unknown>;
}) {
  return {
    partitionKey: input.partitionKey,
    rowKey: input.rowKey,
    ...input.properties,
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "mcp-listas",
    version: "2.1.0",
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
    async ({ includeSystemContainers, includeBlobSamples, samplePerContainer }) => {
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

      return jsonContent(inventory);
    }
  );

  server.tool(
    "table.list",
    "List all tables in the storage account",
    {},
    async () => jsonContent({ tables: await tables.listTables() })
  );

  server.tool(
    "table.createTable",
    "Create a table if it does not already exist.",
    {
      table: z.string().describe("Table name"),
    },
    async ({ table }) => jsonContent(await tables.createTable(table))
  );

  server.tool(
    "table.deleteTable",
    "Delete a table.",
    {
      table: z.string().describe("Table name"),
    },
    async ({ table }) => jsonContent(await tables.deleteTable(table))
  );

  server.tool(
    "table.create",
    "Create an entity (ifNotExists true by default; set false to upsert)",
    {
      table: z.string().optional().describe("Table name"),
      partitionKey: z.string().describe("Partition key"),
      rowKey: z.string().describe("Row key"),
      properties: z.record(z.unknown()).describe("Entity properties"),
      ifNotExists: z.boolean().optional().default(true),
    },
    async ({ table, partitionKey, rowKey, properties, ifNotExists }) =>
      jsonContent(
        await tables.createEntity(
          resolveTableName(table),
          toTableEntity({ partitionKey, rowKey, properties }),
          ifNotExists
        )
      )
  );

  server.tool(
    "table.upsert",
    "Upsert an entity (merge by default; set mode='replace' to replace)",
    {
      table: z.string().optional().describe("Table name"),
      partitionKey: z.string().describe("Partition key"),
      rowKey: z.string().describe("Row key"),
      properties: z.record(z.unknown()).describe("Entity properties"),
      mode: z.enum(["merge", "replace"]).optional().default("merge"),
    },
    async ({ table, partitionKey, rowKey, properties, mode }) =>
      jsonContent(
        await tables.upsertEntity(
          resolveTableName(table),
          toTableEntity({ partitionKey, rowKey, properties }),
          mode
        )
      )
  );

  server.tool(
    "table.read",
    "Read one entity by PartitionKey/RowKey",
    {
      table: z.string().optional().describe("Table name"),
      partitionKey: z.string().describe("Partition key"),
      rowKey: z.string().describe("Row key"),
      select: z.array(z.string()).optional().describe("Properties to select"),
    },
    async ({ table, partitionKey, rowKey, select }) =>
      jsonContent(
        await tables.getEntity(resolveTableName(table), partitionKey, rowKey, select)
      )
  );

  server.tool(
    "table.exists",
    "Check if an entity exists; returns exists=true/false and optional etag",
    {
      table: z.string().optional().describe("Table name"),
      partitionKey: z.string().describe("Partition key"),
      rowKey: z.string().describe("Row key"),
      select: z.array(z.string()).optional().describe("Properties to select"),
    },
    async ({ table, partitionKey, rowKey, select }) =>
      jsonContent(
        await tables.entityExists(resolveTableName(table), partitionKey, rowKey, select)
      )
  );

  server.tool(
    "table.head",
    "Get only headers of an entity (etag/timestamp) without properties",
    {
      table: z.string().optional().describe("Table name"),
      partitionKey: z.string().describe("Partition key"),
      rowKey: z.string().describe("Row key"),
    },
    async ({ table, partitionKey, rowKey }) =>
      jsonContent(
        await tables.headEntity(resolveTableName(table), partitionKey, rowKey)
      )
  );

  server.tool(
    "table.update",
    "Update entity (merge default). Use ifMatch for ETag control",
    {
      table: z.string().optional().describe("Table name"),
      partitionKey: z.string().describe("Partition key"),
      rowKey: z.string().describe("Row key"),
      properties: z.record(z.unknown()).describe("Properties to update"),
      mode: z.enum(["merge", "replace"]).optional().default("merge"),
      ifMatch: z.string().optional().default("*"),
    },
    async ({ table, partitionKey, rowKey, properties, mode, ifMatch }) => {
      await tables.updateEntity(
        resolveTableName(table),
        toTableEntity({ partitionKey, rowKey, properties }),
        mode,
        ifMatch
      );
      return jsonContent({ updated: true });
    }
  );

  server.tool(
    "table.delete",
    "Delete entity by PK/RK (ifMatch '*' by default)",
    {
      table: z.string().optional().describe("Table name"),
      partitionKey: z.string().describe("Partition key"),
      rowKey: z.string().describe("Row key"),
      ifMatch: z.string().optional().default("*"),
    },
    async ({ table, partitionKey, rowKey, ifMatch }) => {
      await tables.deleteEntity(resolveTableName(table), partitionKey, rowKey, ifMatch);
      return jsonContent({ deleted: true });
    }
  );

  server.tool(
    "table.query",
    "Query entities using OData filter and pagination",
    {
      table: z.string().optional().describe("Table name"),
      filter: z.string().optional().describe("OData filter"),
      select: z.array(z.string()).optional().describe("Properties to select"),
      top: z.number().int().positive().optional().describe("Page size"),
      continuationToken: z.string().optional().describe("Continuation token"),
    },
    async ({ table, filter, select, top, continuationToken }) =>
      jsonContent(
        await tables.queryEntitiesPage(resolveTableName(table), {
          filter,
          select,
          top,
          continuationToken,
        })
      )
  );

  server.tool(
    "table.scanPartition",
    "Scan all entities in a partition (paginated)",
    {
      table: z.string().optional().describe("Table name"),
      partitionKey: z.string().describe("Partition key"),
      select: z.array(z.string()).optional().describe("Properties to select"),
      top: z.number().int().positive().optional().describe("Page size"),
      continuationToken: z.string().optional().describe("Continuation token"),
    },
    async ({ table, partitionKey, select, top, continuationToken }) =>
      jsonContent(
        await tables.scanPartition(
          resolveTableName(table),
          partitionKey,
          select,
          top,
          continuationToken
        )
      )
  );

  server.tool(
    "table.queryByPrefix",
    "Query by RowKey prefix within a partition (efficient range scan)",
    {
      table: z.string().optional().describe("Table name"),
      partitionKey: z.string().describe("Partition key"),
      rowKeyPrefix: z.string().describe("RowKey prefix"),
      select: z.array(z.string()).optional().describe("Properties to select"),
      top: z.number().int().positive().optional().describe("Page size"),
      continuationToken: z.string().optional().describe("Continuation token"),
    },
    async ({ table, partitionKey, rowKeyPrefix, select, top, continuationToken }) =>
      jsonContent(
        await tables.queryByPrefix(
          resolveTableName(table),
          partitionKey,
          rowKeyPrefix,
          select,
          top,
          continuationToken
        )
      )
  );

  server.tool(
    "table.deletePartition",
    "Delete all entities in a partition (best-effort, iterative)",
    {
      table: z.string().optional().describe("Table name"),
      partitionKey: z.string().describe("Partition key"),
    },
    async ({ table, partitionKey }) =>
      jsonContent(await tables.deletePartition(resolveTableName(table), partitionKey))
  );

  server.tool(
    "table.batchUpsert",
    "Batch upsert entities grouped by PartitionKey",
    {
      table: z.string().optional().describe("Table name"),
      items: z
        .array(
          z.object({
            partitionKey: z.string(),
            rowKey: z.string(),
            properties: z.record(z.unknown()),
          })
        )
        .describe("Entities to upsert"),
    },
    async ({ table, items }) =>
      jsonContent(
        await tables.batchUpsertEntities(
          resolveTableName(table),
          items.map((item) => toTableEntity(item))
        )
      )
  );

  server.tool(
    "table.create_entity",
    "Create a new entity in an Azure Table. Auto-creates the table if it doesn't exist.",
    {
      tableName: z.string().describe("Table name"),
      entity: z
        .record(z.unknown())
        .describe("Entity object. Must include partitionKey and rowKey as string properties."),
    },
    async ({ tableName, entity }) =>
      jsonContent(await tables.createEntity(tableName, entity, true))
  );

  server.tool(
    "table.get_entity",
    "Get a single entity from an Azure Table by partition key and row key.",
    {
      tableName: z.string().describe("Table name"),
      partitionKey: z.string().describe("Partition key of the entity"),
      rowKey: z.string().describe("Row key of the entity"),
    },
    async ({ tableName, partitionKey, rowKey }) =>
      jsonContent(await tables.getEntity(tableName, partitionKey, rowKey))
  );

  server.tool(
    "table.update_entity",
    "Update an entity in an Azure Table (merge or replace).",
    {
      tableName: z.string().describe("Table name"),
      entity: z
        .record(z.unknown())
        .describe("Entity with partitionKey, rowKey and properties to update"),
      mode: z
        .enum(["merge", "replace"])
        .optional()
        .describe("merge (default) keeps unmentioned fields; replace overwrites all"),
    },
    async ({ tableName, entity, mode }) => {
      await tables.updateEntity(tableName, entity, mode ?? "merge");
      return jsonContent({ updated: true });
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
      return jsonContent({ deleted: true });
    }
  );

  server.tool(
    "container.list",
    "List blob containers in the storage account.",
    {},
    async () => jsonContent({ containers: await blobs.listContainers() })
  );

  server.tool(
    "container.create",
    "Create a blob container if it does not exist.",
    {
      containerName: z.string().describe("Blob container name"),
    },
    async ({ containerName }) => jsonContent(await blobs.createContainer(containerName))
  );

  server.tool(
    "container.delete",
    "Delete a blob container.",
    {
      containerName: z.string().describe("Blob container name"),
    },
    async ({ containerName }) => jsonContent(await blobs.deleteContainer(containerName))
  );

  server.tool(
    "container.exists",
    "Check whether a blob container exists.",
    {
      containerName: z.string().describe("Blob container name"),
    },
    async ({ containerName }) => jsonContent(await blobs.containerExists(containerName))
  );

  server.tool(
    "container.head",
    "Get blob container properties and metadata.",
    {
      containerName: z.string().describe("Blob container name"),
    },
    async ({ containerName }) =>
      jsonContent(await blobs.getContainerProperties(containerName))
  );

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
    async ({ containerName, blobName, content, contentType }) =>
      jsonContent(
        await blobs.uploadBlob(containerName, blobName, content, contentType)
      )
  );

  server.tool(
    "blob.download",
    "Download a blob's content as text.",
    {
      containerName: z.string().describe("Blob container name"),
      blobName: z.string().describe("Blob name / path"),
    },
    async ({ containerName, blobName }) =>
      jsonContent(await blobs.downloadBlob(containerName, blobName))
  );

  server.tool(
    "blob.list",
    "List blobs in a container, optionally filtered by prefix.",
    {
      containerName: z.string().describe("Blob container name"),
      prefix: z.string().optional().describe("Blob name prefix filter"),
    },
    async ({ containerName, prefix }) =>
      jsonContent(await blobs.listBlobs(containerName, prefix))
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
      return jsonContent({ deleted: true });
    }
  );

  server.tool(
    "blob.exists",
    "Check whether a blob exists.",
    {
      containerName: z.string().describe("Blob container name"),
      blobName: z.string().describe("Blob name / path"),
    },
    async ({ containerName, blobName }) =>
      jsonContent(await blobs.blobExists(containerName, blobName))
  );

  server.tool(
    "blob.head",
    "Get blob headers and metadata.",
    {
      containerName: z.string().describe("Blob container name"),
      blobName: z.string().describe("Blob name / path"),
    },
    async ({ containerName, blobName }) =>
      jsonContent(await blobs.getBlobProperties(containerName, blobName))
  );

  server.tool(
    "blob.getProperties",
    "Get detailed blob properties.",
    {
      containerName: z.string().describe("Blob container name"),
      blobName: z.string().describe("Blob name / path"),
    },
    async ({ containerName, blobName }) =>
      jsonContent(await blobs.getBlobProperties(containerName, blobName))
  );

  server.tool(
    "blob.setMetadata",
    "Set blob metadata.",
    {
      containerName: z.string().describe("Blob container name"),
      blobName: z.string().describe("Blob name / path"),
      metadata: z.record(z.string()).describe("Blob metadata"),
    },
    async ({ containerName, blobName, metadata }) =>
      jsonContent(await blobs.setBlobMetadata(containerName, blobName, metadata))
  );

  server.tool(
    "blob.copy",
    "Copy a blob to another container or blob name.",
    {
      sourceContainerName: z.string().describe("Source container name"),
      sourceBlobName: z.string().describe("Source blob name"),
      destinationContainerName: z.string().describe("Destination container name"),
      destinationBlobName: z.string().describe("Destination blob name"),
    },
    async ({
      sourceContainerName,
      sourceBlobName,
      destinationContainerName,
      destinationBlobName,
    }) =>
      jsonContent(
        await blobs.copyBlob(
          sourceContainerName,
          sourceBlobName,
          destinationContainerName,
          destinationBlobName
        )
      )
  );

  server.tool(
    "blob.move",
    "Move a blob to another container or blob name.",
    {
      sourceContainerName: z.string().describe("Source container name"),
      sourceBlobName: z.string().describe("Source blob name"),
      destinationContainerName: z.string().describe("Destination container name"),
      destinationBlobName: z.string().describe("Destination blob name"),
    },
    async ({
      sourceContainerName,
      sourceBlobName,
      destinationContainerName,
      destinationBlobName,
    }) =>
      jsonContent(
        await blobs.moveBlob(
          sourceContainerName,
          sourceBlobName,
          destinationContainerName,
          destinationBlobName
        )
      )
  );

  return server;
}