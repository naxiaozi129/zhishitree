# 将本仓库同步到 Z 盘副本（按需修改 $Dst）
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Dst = 'Z:\考试\错题分析追溯'

if (-not (Test-Path $Dst)) {
  Write-Error "目标不存在: $Dst"
  exit 1
}

Copy-Item -Force (Join-Path $Root 'vite.config.ts') (Join-Path $Dst 'vite.config.ts')
Copy-Item -Force (Join-Path $Root 'package.json') (Join-Path $Dst 'package.json')
if (Test-Path (Join-Path $Root 'package-lock.json')) {
  Copy-Item -Force (Join-Path $Root 'package-lock.json') (Join-Path $Dst 'package-lock.json')
}
Copy-Item -Force -Recurse (Join-Path $Root 'server') (Join-Path $Dst 'server')
Copy-Item -Force -Recurse (Join-Path $Root 'src') (Join-Path $Dst 'src')
Write-Host "已同步 -> $Dst"
