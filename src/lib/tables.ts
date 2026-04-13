import {
  TableClient,
  TableEntity,
  TableServiceClient,
} from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";

type TableEntityRecord = Record<string, unknown>;

type QueryPageOptions = {
  filter?: string;
  select?: string[];
  top?: number;
  continuationToken?: string;
};

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

export async function createTable(tableName: string): Promise<{ table: string }> {
  const serviceClient = getTableServiceClient();
  await serviceClient.createTable(tableName);
  return { table: tableName };
}

export async function deleteTable(tableName: string): Promise<{ table: string }> {
  const serviceClient = getTableServiceClient();
  await serviceClient.deleteTable(tableName);
  return { table: tableName };
}

export async function createEntity(
  tableName: string,
  entity: TableEntityRecord,
  ifNotExists = true
): Promise<TableEntityRecord> {
  const client = getTableClient(tableName);
  await client.createTable(); // idempotent
  const result = ifNotExists
    ? await client.createEntity(entity as TableEntity<object>)
    : await client.upsertEntity(entity as TableEntity<object>, "Merge");
  return { ...entity, etag: result.etag };
}

export async function upsertEntity(
  tableName: string,
  entity: TableEntityRecord,
  mode: "merge" | "replace" = "merge"
): Promise<TableEntityRecord> {
  const client = getTableClient(tableName);
  await client.createTable();
  const result = await client.upsertEntity(
    entity as TableEntity<object>,
    mode === "merge" ? "Merge" : "Replace"
  );
  return { ...entity, etag: result.etag };
}

export async function getEntity(
  tableName: string,
  partitionKey: string,
  rowKey: string,
  select?: string[]
): Promise<TableEntityRecord> {
  const client = getTableClient(tableName);
  const entity = await client.getEntity(
    partitionKey,
    rowKey,
    select ? ({ queryOptions: { select } } as any) : undefined
  );
  return entity as unknown as TableEntityRecord;
}

export async function entityExists(
  tableName: string,
  partitionKey: string,
  rowKey: string,
  select?: string[]
): Promise<{ exists: boolean; etag?: string; entity?: TableEntityRecord }> {
  try {
    const entity = await getEntity(tableName, partitionKey, rowKey, select);
    return {
      exists: true,
      etag: typeof entity.etag === "string" ? entity.etag : undefined,
      entity,
    };
  } catch (error: any) {
    if (error?.statusCode === 404) {
      return { exists: false };
    }
    throw error;
  }
}

export async function headEntity(
  tableName: string,
  partitionKey: string,
  rowKey: string
): Promise<{ etag?: string; timestamp?: string }> {
  const entity = await getEntity(tableName, partitionKey, rowKey, ["Timestamp"]);
  const timestamp = entity.timestamp ?? entity.Timestamp;

  return {
    etag: typeof entity.etag === "string" ? entity.etag : undefined,
    timestamp: timestamp ? String(timestamp) : undefined,
  };
}

export async function queryEntitiesPage(
  tableName: string,
  options: QueryPageOptions = {}
): Promise<{ items: TableEntityRecord[]; continuationToken?: string }> {
  const client = getTableClient(tableName);
  const queryOptions: Record<string, unknown> = {};

  if (options.filter) queryOptions.filter = options.filter;
  if (options.select) queryOptions.select = options.select;

  const pageIterator = client
    .listEntities({ queryOptions } as any)
    .byPage({
      continuationToken: options.continuationToken,
      maxPageSize: options.top,
    } as any);

  const page = await pageIterator.next();
  const rawPage = page.value as any;
  const items = rawPage ? Array.from(rawPage) : [];

  return {
    items: items as TableEntityRecord[],
    continuationToken: rawPage?.continuationToken,
  };
}

export async function queryEntities(
  tableName: string,
  filter?: string,
  select?: string[],
  top?: number
): Promise<TableEntityRecord[]> {
  const result = await queryEntitiesPage(tableName, { filter, select, top });
  return result.items;
}

export async function scanPartition(
  tableName: string,
  partitionKey: string,
  select?: string[],
  top?: number,
  continuationToken?: string
): Promise<{ items: TableEntityRecord[]; continuationToken?: string }> {
  return queryEntitiesPage(tableName, {
    filter: `PartitionKey eq '${escapeODataValue(partitionKey)}'`,
    select,
    top,
    continuationToken,
  });
}

export async function queryByPrefix(
  tableName: string,
  partitionKey: string,
  rowKeyPrefix: string,
  select?: string[],
  top?: number,
  continuationToken?: string
): Promise<{ items: TableEntityRecord[]; continuationToken?: string }> {
  const lowerBound = escapeODataValue(rowKeyPrefix);
  const upperBound = escapeODataValue(`${rowKeyPrefix}\uffff`);

  return queryEntitiesPage(tableName, {
    filter:
      `PartitionKey eq '${escapeODataValue(partitionKey)}' ` +
      `and RowKey ge '${lowerBound}' and RowKey lt '${upperBound}'`,
    select,
    top,
    continuationToken,
  });
}

export async function updateEntity(
  tableName: string,
  entity: TableEntityRecord,
  mode: "merge" | "replace" = "merge",
  ifMatch = "*"
): Promise<void> {
  const client = getTableClient(tableName);
  await client.updateEntity(
    entity as TableEntity<object>,
    mode === "merge" ? "Merge" : "Replace",
    { etag: ifMatch } as any
  );
}

export async function deleteEntity(
  tableName: string,
  partitionKey: string,
  rowKey: string,
  ifMatch = "*"
): Promise<void> {
  const client = getTableClient(tableName);
  await client.deleteEntity(partitionKey, rowKey, { etag: ifMatch } as any);
}

export async function deletePartition(
  tableName: string,
  partitionKey: string
): Promise<{ deleted: number }> {
  let deleted = 0;
  let continuationToken: string | undefined;

  do {
    const page = await scanPartition(tableName, partitionKey, undefined, 100, continuationToken);

    for (const item of page.items) {
      await deleteEntity(
        tableName,
        String(item.partitionKey ?? item.PartitionKey),
        String(item.rowKey ?? item.RowKey)
      );
      deleted += 1;
    }

    continuationToken = page.continuationToken;
  } while (continuationToken);

  return { deleted };
}

export async function batchUpsertEntities(
  tableName: string,
  items: TableEntityRecord[]
): Promise<{ processed: number }> {
  const client = getTableClient(tableName);
  await client.createTable();

  for (const item of items) {
    await client.upsertEntity(item as TableEntity<object>, "Merge");
  }

  return { processed: items.length };
}

function escapeODataValue(value: string): string {
  return value.replace(/'/g, "''");
}
