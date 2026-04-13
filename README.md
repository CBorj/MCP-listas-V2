# mcp-listas-v2

Servidor MCP sobre Azure Functions que expone un catalogo ampliado de tools para trabajar con Azure Table Storage, Blob Storage y contenedores mediante Streamable HTTP.

El proyecto está pensado para desplegarse como endpoint MCP remoto y consumirse desde clientes compatibles como Copilot Studio.

## Resumen

- Transporte MCP Streamable HTTP real sobre Azure Functions.
- 35 tools para Table Storage, Blob Storage y contenedores.
- Managed Identity en Azure.
- Azurite para desarrollo local.
- Despliegue automatizable con PowerShell.

## Qué hace

La Function recibe peticiones MCP en `/api/mcp`, crea un `McpServer` por request y ejecuta las tools registradas contra Azure Storage.

Flujo básico:

1. El cliente hace `POST` a `/api/mcp`.
2. La Function adapta la request al transporte `WebStandardStreamableHTTPServerTransport` del SDK MCP.
3. Se crea un `McpServer` stateless para esa petición.
4. Las tools delegan en las librerías de acceso a Table Storage, Blob Storage y contenedores.
5. La respuesta vuelve al cliente como respuesta MCP Streamable HTTP.

Las tools `table.*` siguen la nomenclatura del MCP desplegado en Azure para mantener paridad entre el endpoint local y el remoto.

## Tools disponibles

### Inventario

- `storage.inspect`

### Table Storage

- `table.list`
- `table.createTable`
- `table.deleteTable`
- `table.create`
- `table.upsert`
- `table.read`
- `table.exists`
- `table.head`
- `table.update`
- `table.delete`
- `table.query`
- `table.scanPartition`
- `table.queryByPrefix`
- `table.deletePartition`
- `table.batchUpsert`

### Table Storage compatibilidad local

- `table.create_entity`
- `table.get_entity`
- `table.update_entity`
- `table.delete_entity`

### Containers

- `container.list`
- `container.create`
- `container.delete`
- `container.exists`
- `container.head`

### Blob Storage

- `blob.upload`
- `blob.download`
- `blob.list`
- `blob.delete`
- `blob.exists`
- `blob.head`
- `blob.getProperties`
- `blob.setMetadata`
- `blob.copy`
- `blob.move`

## Estructura del proyecto

```text
mcp-listas-v2/
  .gitignore
  .funcignore
  host.json
  local.settings.example.json
  package.json
  package-lock.json
  test-init.json
  test-tools.json
  tsconfig.json
  scripts/
    deploy.ps1
    invoke-mcp.ps1
  src/
    functions/
      mcp.ts
    lib/
      blobs.ts
      server.ts
      tables.ts
  tests/
    mcp/
      README.md
      requests/
        initialize.json
        tools-list.json
```

## Archivos principales

- `src/functions/mcp.ts`: handler HTTP de Azure Functions y bridge hacia el transporte MCP.
- `src/lib/server.ts`: registro de tools y definición de esquemas de entrada con `zod`.
- `src/lib/tables.ts`: operaciones sobre Azure Table Storage.
- `src/lib/blobs.ts`: operaciones sobre Azure Blob Storage.
- `scripts/deploy.ps1`: provisión de recursos Azure y publicación de la Function App.
- `scripts/invoke-mcp.ps1`: helper para invocar el endpoint MCP con un body JSON.
- `local.settings.example.json`: plantilla pública para configurar el entorno local.

## Autenticación a Storage

### Azure

En Azure, la app usa:

- `STORAGE_ACCOUNT_NAME`
- `DefaultAzureCredential`
- Managed Identity asignada a la Function App

Con eso, el acceso a Blob y Table se resuelve sin connection strings en código.

### Local

En local, el proyecto usa normalmente:

- `STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true`
- `AzureWebJobsStorage=UseDevelopmentStorage=true`

Esto permite trabajar con Azurite sin depender de una identidad administrada.

## Requisitos para desarrollo local

Necesitas lo siguiente:

- Node.js
- npm
- Azure Functions Core Tools v4
- Azurite

## Configuración local

1. Instala dependencias:

```powershell
npm install
```

1. Crea `local.settings.json` a partir de `local.settings.example.json`.

Plantilla base:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "STORAGE_CONNECTION_STRING": "UseDevelopmentStorage=true"
  }
}
```

1. Arranca Azurite.

1. Compila el proyecto:

```powershell
npm run build
```

1. Ejecuta la Function localmente:

```powershell
npm start
```

No subas `local.settings.json`, function keys, connection strings ni secretos reales al repositorio.

## Endpoint y protocolo

Endpoint esperado en Azure:

```text
POST https://<function-app-name>.azurewebsites.net/api/mcp
```

Puntos relevantes:

- El endpoint usa MCP Streamable HTTP real del SDK.
- La autenticación del endpoint está pensada para `function` auth.
- Para Copilot Studio, la API key se envía en query con nombre `code`.
- El cliente debe enviar `Accept: application/json, text/event-stream`.
- El `Content-Type` debe ser `application/json`.
- Se soportan requests simples y batch.

## Uso con Copilot Studio

Configuración recomendada:

1. `Server URL`: `https://<function-app-name>.azurewebsites.net/api/mcp`
2. `Authentication type`: `API key`
3. `API key location`: `Query`
4. `Query parameter name`: `code`
5. Usa la function key como valor del API key.

## Ejemplos de uso

### Inicialización MCP

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": {
      "name": "test",
      "version": "1.0"
    }
  }
}
```

### Listar tools

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

### Invocar una tool

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "blob.upload",
    "arguments": {
      "containerName": "documentos",
      "blobName": "demo.txt",
      "content": "hola desde MCP",
      "contentType": "text/plain"
    }
  }
}
```

## Despliegue

El script de despliegue está en `scripts/deploy.ps1`.

Variables relevantes del entorno desplegado:

- Runtime esperado en Azure: `Node 22`
- `FUNCTIONS_WORKER_RUNTIME=node`
- `STORAGE_ACCOUNT_NAME=<nombre-de-storage-account>`

## Seguridad del repositorio

Antes de publicar cambios, verifica que no se suben estos elementos:

- `local.settings.json`
- `.azurite/`
- `node_modules/`
- `dist/`
- function keys
- SAS tokens
- connection strings
- secretos pegados en scripts, tests o documentación

Qué hace:

1. Hace login con Azure CLI si hace falta.
2. Crea el Resource Group.
3. Crea la Storage Account.
4. Crea la Function App Linux.
5. Activa Managed Identity.
6. Asigna roles para Blob y Table.
7. Configura `STORAGE_ACCOUNT_NAME`.
8. Compila y publica la Function.
9. Recupera la function key.

## Observaciones

- El endpoint implementa Streamable HTTP del SDK MCP en modo stateless con respuesta JSON, que es adecuado para Azure Functions y Copilot Studio.
- La librería crea contenedores y tablas automáticamente cuando corresponde.
- No hay tests automatizados en el proyecto; la validación actual es de integración contra Azure.

## Posibles mejoras

- Añadir tests automatizados para el catalogo completo de tools.
- Externalizar ejemplos de requests en una carpeta `examples/`.
- Añadir logging estructurado para errores operativos.
- Evitar incluir secretos manualmente en pruebas y documentación.
