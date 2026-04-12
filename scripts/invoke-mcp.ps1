param(
    [Parameter(Mandatory = $true)]
    [string]$BodyFile,

    [string]$Endpoint = $env:MCP_ENDPOINT,

    [string]$ApiKey = $env:MCP_FUNCTION_KEY,

    [string]$ProtocolVersion = "2025-03-26"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BodyFile)) {
    throw "Body file not found: $BodyFile"
}

if (-not $ApiKey) {
    throw "Set -ApiKey or define MCP_FUNCTION_KEY in the environment."
}

if (-not $Endpoint) {
    throw "Set -Endpoint or define MCP_ENDPOINT in the environment."
}

$headers = @{
    Accept = "application/json, text/event-stream"
    "Content-Type" = "application/json"
    "mcp-protocol-version" = $ProtocolVersion
}

$body = Get-Content -Raw -Path $BodyFile
$uriBuilder = [System.UriBuilder]::new($Endpoint)
$uriBuilder.Query = "code=$([System.Uri]::EscapeDataString($ApiKey.Trim()))"
$uri = $uriBuilder.Uri.AbsoluteUri

Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body | ConvertTo-Json -Depth 20