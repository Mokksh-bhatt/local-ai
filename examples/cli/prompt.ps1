# One-shot prompt against the local hub. Start the hub first: npm run dev
$Hub = if ($env:HUB) { $env:HUB } else { "http://127.0.0.1:5173" }
$Adapter = if ($env:ADAPTER) { $env:ADAPTER } else { "claude" }
$Workspace = if ($env:WORKSPACE) { $env:WORKSPACE } else { (Get-Location).Path }
$Text = if ($args.Count -gt 0) { $args[0] } elseif ($env:TEXT) { $env:TEXT } else { "Reply with pong only. No extra words." }

$body = @{
  adapterId  = $Adapter
  text       = $Text
  mode       = "ask"
  permission = "auto"
  workspace  = $Workspace
} | ConvertTo-Json

# curl.exe is real curl; bare `curl` in PowerShell is Invoke-WebRequest
curl.exe -sS "$Hub/api/prompt" -H "Content-Type: application/json" -d $body
Write-Host
