# 为局域网访问开放 Windows 防火墙端口（需管理员 PowerShell）
# 用法：.\scripts\open-lan-firewall.ps1

$ports = @(3010, 5180, 8080, 8790)
foreach ($port in $ports) {
  $name = "Zhishitree TCP $port"
  $existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "规则已存在: $name"
    continue
  }
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port | Out-Null
  Write-Host "已放行端口: $port"
}

Write-Host ""
Write-Host "本机局域网 IP："
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
  ForEach-Object { Write-Host "  http://$($_.IPAddress):8790  （生产，推荐）" }
Write-Host "  http://<IP>:3010  （开发）"
