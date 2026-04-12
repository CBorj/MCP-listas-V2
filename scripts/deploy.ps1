# ─────────────────────────────────────────────────────────────
# deploy.ps1 — Provision Azure resources and deploy mcp-listas-v2
# Run from the mcp-listas-v2/ directory.
# Prerequisites: az CLI, func CLI (Azure Functions Core Tools)
# ─────────────────────────────────────────────────────────────

param(
    [string]$ResourceGroup   = "rg-mcp-listas-demo",
    [string]$Location        = "westeurope",
    [string]$FunctionAppName = "mcp-listas-demo",
    [string]$StorageAccount  = "stmcplistasdemo"     # change this value if the name is already taken
)

$ErrorActionPreference = "Stop"

Write-Host "── 1. Login (skip if already authenticated) ──"
$account = az account show --query "user.name" -o tsv 2>$null
if (-not $account) {
    az login
}
Write-Host "Signed in as: $(az account show --query user.name -o tsv)"

Write-Host "`n── 2. Resource Group ──"
az group create --name $ResourceGroup --location $Location | Out-Null
Write-Host "RG: $ResourceGroup ($Location)"

Write-Host "`n── 3. Storage Account ──"
az storage account create `
    --name $StorageAccount `
    --resource-group $ResourceGroup `
    --location $Location `
    --sku Standard_LRS `
    --kind StorageV2 `
    --min-tls-version TLS1_2 `
    --https-only true | Out-Null
Write-Host "Storage: $StorageAccount"

Write-Host "`n── 4. Function App (Consumption, Linux, Node 22) ──"
az functionapp create `
    --name $FunctionAppName `
    --resource-group $ResourceGroup `
    --storage-account $StorageAccount `
    --consumption-plan-location $Location `
    --runtime node `
    --runtime-version 22 `
    --os-type Linux `
    --functions-version 4 `
    --https-only true `
    --disable-app-insights true | Out-Null
Write-Host "Function App: $FunctionAppName"

Write-Host "`n── 5. Enable System-Assigned Managed Identity ──"
$principalId = az functionapp identity assign `
    --name $FunctionAppName `
    --resource-group $ResourceGroup `
    --query principalId -o tsv
Write-Host "Managed Identity principal: $principalId"

Write-Host "`n── 6. Assign Storage Roles to Managed Identity ──"
$storageId = az storage account show `
    --name $StorageAccount `
    --resource-group $ResourceGroup `
    --query id -o tsv

# Storage Blob Data Contributor
az role assignment create `
    --assignee $principalId `
    --role "Storage Blob Data Contributor" `
    --scope $storageId | Out-Null

# Storage Table Data Contributor
az role assignment create `
    --assignee $principalId `
    --role "Storage Table Data Contributor" `
    --scope $storageId | Out-Null

Write-Host "Roles assigned: Blob + Table Data Contributor"

Write-Host "`n── 7. Configure App Settings ──"
az functionapp config appsettings set `
    --name $FunctionAppName `
    --resource-group $ResourceGroup `
    --settings "STORAGE_ACCOUNT_NAME=$StorageAccount" | Out-Null
Write-Host "STORAGE_ACCOUNT_NAME = $StorageAccount"

Write-Host "`n── 8. Build & Deploy ──"
npm run build
func azure functionapp publish $FunctionAppName

Write-Host "`n── 9. Retrieve Function Key ──"
$key = az functionapp keys list `
    --name $FunctionAppName `
    --resource-group $ResourceGroup `
    --query "functionKeys.default" -o tsv
Write-Host "Function Key: $key"

Write-Host "`n── Done ──"
Write-Host "MCP endpoint: https://$FunctionAppName.azurewebsites.net/api/mcp?code=$key"
Write-Host "In Copilot Studio use Server URL: https://$FunctionAppName.azurewebsites.net/api/mcp"
Write-Host "Auth type: API key | Location: Query | Parameter name: code"
