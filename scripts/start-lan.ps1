# 局域网完整服务（前端 + API，端口 8787）
# 用法：.\scripts\start-lan.ps1

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$port = if ($env:PORT) { $env:PORT } else { "8790" }

Write-Host "[zhishitree] 释放端口 $port ..."
Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

$env:NODE_ENV = "production"
$env:HOST = "0.0.0.0"
$env:COOKIE_SECURE = "0"
$env:PORT = $port

Write-Host "[zhishitree] 构建前端..."
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[zhishitree] 启动局域网服务 (PORT=$port)..."
npm run start
