import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

function getBlobServiceClient(): BlobServiceClient {
  const connStr = process.env.STORAGE_CONNECTION_STRING;
  if (connStr) {
    return BlobServiceClient.fromConnectionString(connStr);
  }
  const accountName = process.env.STORAGE_ACCOUNT_NAME;
  if (!accountName) {
    throw new Error(
      "Set STORAGE_CONNECTION_STRING or STORAGE_ACCOUNT_NAME env var"
    );
  }
  return new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    new DefaultAzureCredential()
  );
}

async function getContainer(containerName: string): Promise<ContainerClient> {
  const service = getBlobServiceClient();
  const container = service.getContainerClient(containerName);
  await container.createIfNotExists();
  return container;
}

export async function listContainers(): Promise<
  { name: string; lastModified: string }[]
> {
  const service = getBlobServiceClient();
  const results: { name: string; lastModified: string }[] = [];

  for await (const container of service.listContainers()) {
    results.push({
      name: container.name,
      lastModified: container.properties.lastModified?.toISOString() ?? "",
    });
  }

  return results.sort((left, right) => left.name.localeCompare(right.name));
}

export async function uploadBlob(
  containerName: string,
  blobName: string,
  content: string,
  contentType = "application/octet-stream"
): Promise<{ url: string }> {
  const container = await getContainer(containerName);
  const blob = container.getBlockBlobClient(blobName);
  await blob.upload(content, Buffer.byteLength(content), {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  return { url: blob.url };
}

export async function downloadBlob(
  containerName: string,
  blobName: string
): Promise<{ content: string; contentType: string }> {
  const container = await getContainer(containerName);
  const blob = container.getBlockBlobClient(blobName);
  const response = await blob.download(0);
  const body = await streamToString(response.readableStreamBody!);
  return {
    content: body,
    contentType: response.contentType ?? "application/octet-stream",
  };
}

export async function listBlobs(
  containerName: string,
  prefix?: string,
  maxResults?: number
): Promise<{ name: string; size: number; lastModified: string }[]> {
  const container = await getContainer(containerName);
  const results: { name: string; size: number; lastModified: string }[] = [];
  for await (const item of container.listBlobsFlat({
    prefix: prefix ?? undefined,
  })) {
    results.push({
      name: item.name,
      size: item.properties.contentLength ?? 0,
      lastModified: item.properties.lastModified?.toISOString() ?? "",
    });

    if (maxResults && results.length >= maxResults) {
      break;
    }
  }
  return results;
}

export async function deleteBlob(
  containerName: string,
  blobName: string
): Promise<void> {
  const container = await getContainer(containerName);
  const blob = container.getBlockBlobClient(blobName);
  await blob.delete();
}

async function streamToString(
  stream: NodeJS.ReadableStream
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
