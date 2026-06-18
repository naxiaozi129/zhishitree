# 生产部署启动脚本（Windows）
# 用法：.\scripts\start-production.ps1

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$env:NODE_ENV = "production"
if (-not $env:PORT) { $env:PORT = "8787" }

Write-Host "[zhishitree] 构建前端..."
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[zhishitree] 启动生产服务 (PORT=$env:PORT)..."
npm run start
