import {
  TableClient,
  TableEntity,
  TableServiceClient,
} from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";

function getTableServiceClient(): TableServiceClient {
  const connStr = process.env.STORAGE_CONNECTION_STRING;
  if (connStr) {
    return TableServiceClient.fromConnectionString(connStr);
  }
  const accountName = process.env.STORAGE_ACCOUNT_NAME;
  if (!accountName) {
    throw new Error(
      "Set STORAGE_CONNECTION_STRING or STORAGE_ACCOUNT_NAME env var"
    );
  }
  return new TableServiceClient(
    `https://${accountName}.table.core.windows.net`,
    new DefaultAzureCredential()
  );
}

function getTableClient(tableName: string): TableClient {
  const connStr = process.env.STORAGE_CONNECTION_STRING;
  if (connStr) {
    return TableClient.fromConnectionString(connStr, tableName);
  }
  const accountName = process.env.STORAGE_ACCOUNT_NAME;
  if (!accountName) {
    throw new Error(
      "Set STORAGE_CONNECTION_STRING or STORAGE_ACCOUNT_NAME env var"
    );
  }
  return new TableClient(
    `https://${accountName}.table.core.windows.net`,
    tableName,
    new DefaultAzureCredential()
  );
}

export async function listTables(): Promise<string[]> {
  const serviceClient = getTableServiceClient();
  const tables: string[] = [];

  for await (const table of serviceClient.listTables()) {
    if (table.name) {
      tables.push(table.name);
    }
  }

  return tables.sort((left, right) => left.localeCompare(right));
}

export async function createEntity(
  tableName: string,
  entity: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const client = getTableClient(tableName);
  await client.createTable(); // idempotent
  const result = await client.createEntity(entity as TableEntity<object>);
  return { ...entity, etag: result.etag };
}

export async function getEntity(
  tableName: string,
  partitionKey: string,
  rowKey: string
): Promise<Record<string, unknown>> {
  const client = getTableClient(tableName);
  const entity = await client.getEntity(partitionKey, rowKey);
  return entity as unknown as Record<string, unknown>;
}

export async function queryEntities(
  tableName: string,
  filter?: string,
  select?: string[],
  top?: number
): Promise<Record<string, unknown>[]> {
  const client = getTableClient(tableName);
  const results: Record<string, unknown>[] = [];
  const queryOptions: Record<string, unknown> = {};
  if (filter) queryOptions.filter = filter;
  if (select) queryOptions.select = select;

  for await (const entity of client.listEntities({ queryOptions } as any)) {
    results.push(entity as unknown as Record<string, unknown>);
    if (top && results.length >= top) break;
  }
  return results;
}

export async function updateEntity(
  tableName: string,
  entity: Record<string, unknown>,
  mode: "merge" | "replace" = "merge"
): Promise<void> {
  const client = getTableClient(tableName);
  await client.updateEntity(
    entity as TableEntity<object>,
    mode === "merge" ? "Merge" : "Replace"
  );
}

export async function deleteEntity(
  tableName: string,
  partitionKey: string,
  rowKey: string
): Promise<void> {
  const client = getTableClient(tableName);
  await client.deleteEntity(partitionKey, rowKey);
}
