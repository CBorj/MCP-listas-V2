# mcp-listas-v2

MCP server sobre Azure Functions que expone 9 tools para trabajar con Azure Table Storage y Azure Blob Storage mediante Streamable HTTP compatible con MCP.

El proyecto está pensado para usarse como endpoint MCP remoto desde clientes compatibles, por ejemplo Copilot Studio, apuntando al endpoint HTTP de la Function.

## Descripcion corta para GitHub

Servidor MCP para Azure Functions con soporte Streamable HTTP y 9 tools para operar sobre Azure Table Storage y Azure Blob Storage usando Managed Identity en Azure y Azurite en local.

## Estado actual del despliegue

- Runtime en Azure: `Node 22`
- Auth del endpoint: `function`
- Endpoint base esperado: `https://<function-app-name>.azurewebsites.net/api/mcp`
- Acceso a Storage: Managed Identity con roles `Storage Blob Data Contributor` y `Storage Table Data Contributor`

No publiques function keys, connection strings ni valores reales de `local.settings.json`.

## Qué hace

La Azure Function recibe peticiones MCP Streamable HTTP en `/api/mcp`, crea un `McpServer` por request y delega la ejecución de las tools registradas.

El flujo es este:

1. El cliente hace `POST` al endpoint `/api/mcp`.
2. La Function adapta la request al transporte `WebStandardStreamableHTTPServerTransport` del SDK MCP.
3. Se crea un `McpServer` con 9 tools.
4. Cada tool llama a una librería de acceso a Azure Storage.
5. La respuesta vuelve al cliente en modo Streamable HTTP con respuesta JSON.

## Estructura del proyecto

```text
mcp-listas-v2/
  .gitignore
  host.json
  local.settings.example.json
  package.json
  test-init.json
  test-tools.json
  tsconfig.json
  scripts/
    deploy.ps1
  src/
    functions/
      mcp.ts
    lib/
      blobs.ts
      server.ts
      tables.ts
```

## Archivos principales

- `src/functions/mcp.ts`
  Handler HTTP de Azure Functions. Adapta la request de Azure Functions al transporte `WebStandardStreamableHTTPServerTransport` del SDK MCP en modo stateless con respuestas JSON.

- `src/lib/server.ts`
  Registra las 9 tools del servidor MCP y define sus esquemas de entrada con `zod`.

- `src/lib/tables.ts`
  Implementa operaciones sobre Azure Table Storage. Usa `STORAGE_CONNECTION_STRING` si existe y, si no, usa `STORAGE_ACCOUNT_NAME` + `DefaultAzureCredential`.

- `src/lib/blobs.ts`
  Implementa operaciones sobre Azure Blob Storage con la misma estrategia de autenticación que `tables.ts`.

- `scripts/deploy.ps1`
  Provisiona Resource Group, Storage Account, Function App, Managed Identity, roles RBAC y publica la app.

- `local.settings.example.json`
  Plantilla publica para configurar el entorno local sin subir secretos.

- `test-init.json`
  Ejemplo de request JSON-RPC para `initialize`.

- `test-tools.json`
  Ejemplo de request JSON-RPC para `tools/list`.

## Tools disponibles

### Table Storage

#### `table.create_entity`
Crea una entidad en una tabla. Si la tabla no existe, la crea.

Entrada:

```json
{
  "tableName": "MiTabla",
  "entity": {
    "partitionKey": "demo",
    "rowKey": "1",
    "title": "hola"
  }
}
```

#### `table.get_entity`
Obtiene una entidad por `partitionKey` y `rowKey`.

#### `table.query`
Consulta entidades con filtro OData opcional, `select` opcional y `top` opcional.

#### `table.update_entity`
Actualiza una entidad. Soporta:

- `merge`: conserva propiedades no enviadas.
- `replace`: reemplaza la entidad completa.

#### `table.delete_entity`
Elimina una entidad por `partitionKey` y `rowKey`.

### Blob Storage

#### `blob.upload`
Sube contenido de texto como blob. Si el contenedor no existe, lo crea.

Entrada:

```json
{
  "containerName": "documentos",
  "blobName": "demo.txt",
  "content": "hola",
  "contentType": "text/plain"
}
```

#### `blob.download`
Descarga un blob como texto.

#### `blob.list`
Lista blobs de un contenedor. Puede filtrar por prefijo.

#### `blob.delete`
Elimina un blob.

## Cómo funciona la autenticación a Storage

Hay dos modos:

### Azure

En Azure, la app está pensada para usar:

- `STORAGE_ACCOUNT_NAME`
- `DefaultAzureCredential`
- Managed Identity asignada a la Function App

Con esto, el acceso a Blob y Table se resuelve sin connection strings en código.

### Local

En local, el proyecto usa normalmente:

- `STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true`
- `AzureWebJobsStorage=UseDevelopmentStorage=true`

Esto permite trabajar con Azurite sin tocar la identidad administrada.

## Variables de entorno

### Requeridas para ejecución local

Parte de esta plantilla publica:

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

Crea tu propio `local.settings.json` a partir de `local.settings.example.json` y no lo subas al repositorio.

### Requeridas en Azure

- `FUNCTIONS_WORKER_RUNTIME=node`
- `STORAGE_ACCOUNT_NAME=<nombre de la storage account>`

## Endpoint y protocolo

El endpoint expuesto es:

```text
POST https://<function-app-name>.azurewebsites.net/api/mcp
```

Reglas importantes:

- El endpoint usa MCP Streamable HTTP real del SDK.
- Para Copilot Studio, configura autenticación `API key` en `Query` con nombre `code`.
- El cliente debe enviar `Accept: application/json, text/event-stream`.
- El `Content-Type` debe ser `application/json`.
- Se soporta request simple y batch.

## Alta en Copilot Studio

Configuración recomendada en el asistente MCP de Copilot Studio:

1. `Server URL`: `https://<function-app-name>.azurewebsites.net/api/mcp`
2. `Authentication type`: `API key`
3. `API key location`: `Query`
4. `Query parameter name`: `code`
5. En la conexión, pega la function key como valor del API key.

Con esta configuración, Copilot Studio llamará al endpoint como `https://<function-app-name>.azurewebsites.net/api/mcp?code=...` sin que tengas que fijar el secreto en la URL base.

## Publicación segura del repositorio

Antes de publicar el repo, verifica que no se suben estos elementos:

- `local.settings.json`
- `.azurite/`
- `node_modules/`
- `dist/`
- Function keys, SAS tokens, connection strings o secretos pegados en scripts, tests o documentación

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

## Validación realizada sobre Azure

Se probó contra el endpoint desplegado en Azure:

- `initialize`: correcto
- `tools/list`: correcto
- `blob.upload`: correcto
- `blob.download`: correcto
- `blob.list`: correcto
- `blob.delete`: correcto
- `table.create_entity`: correcto
- `table.get_entity`: correcto
- `table.update_entity`: correcto
- `table.query`: correcto
- `table.delete_entity`: correcto

Las pruebas confirmaron que:

- el endpoint MCP responde correctamente por HTTP,
- las 9 tools están registradas,
- la Managed Identity tiene acceso efectivo a Blob y Table Storage.

## Desarrollo

Instalación:

```powershell
npm install
```

Compilación:

```powershell
npm run build
```

Ejecución local:

```powershell
npm start
```

## Despliegue

El script de despliegue está en `scripts/deploy.ps1`.

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

- Añadir tests automatizados para las 9 tools.
- Externalizar ejemplos de requests en una carpeta `examples/`.
- Añadir logging estructurado para errores operativos.
- Evitar incluir secretos manualmente en pruebas y documentación.