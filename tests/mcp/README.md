# MCP smoke tests

Estructura minima para repetir pruebas contra el endpoint MCP remoto.

## Script

Usa `scripts/invoke-mcp.ps1` para enviar cualquier request JSON guardada en disco.

Ejemplo:

```powershell
$env:MCP_FUNCTION_KEY = "<function-key>"
./scripts/invoke-mcp.ps1 -BodyFile ./tests/mcp/requests/initialize.json
./scripts/invoke-mcp.ps1 -BodyFile ./tests/mcp/requests/tools-list.json
```

## Inventario actual de Storage

Contenedores:

- `azure-webjobs-hosts`
- `azure-webjobs-secrets`
- `function-releases`
- `mcpsmoketest`
- `scm-releases`

Tablas:

- `McpSmokeTest`

## Estado actual observado

- `mcpsmoketest` existe pero `blob.list` devuelve `[]`
- `McpSmokeTest` existe pero `table.query` devuelve `[]`
- `function-releases` contiene paquetes zip de despliegue de la Function App
- `azure-webjobs-hosts` contiene artefactos internos del runtime de Azure Functions

## Siguiente paso recomendado

Crear un juego de smoke tests de negocio sobre:

- `blob.upload`
- `blob.download`
- `blob.list`
- `blob.delete`
- `table.create_entity`
- `table.get_entity`
- `table.update_entity`
- `table.query`
- `table.delete_entity`