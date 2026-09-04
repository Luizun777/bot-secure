# bot-secure: lanzador de hooks de Claude Code para Windows nativo (PowerShell 5.1+ / pwsh).
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File ./.claude/hooks/run.ps1 <evento>
# Resuelve node: BOT_SECURE_NODE -> .bot-secure/local.json -> Get-Command node -> rutas típicas. Sin node: exit 2 (fail-closed).
param([Parameter(Position = 0)][string]$Event = 'pre-tool')
$ErrorActionPreference = 'Stop'
function Fail($msg) { [Console]::Error.WriteLine("bot-secure: $msg"); exit 2 }
try {
  $dir = (Get-Location).Path
  $ws = $null
  while ($dir) {
    if (Test-Path (Join-Path $dir '.bot-secure\policy.json')) { $ws = $dir; break }
    $parent = Split-Path -Parent $dir
    if (-not $parent -or $parent -eq $dir) { break }
    $dir = $parent
  }
  if (-not $ws) { Fail "no encuentro el workspace (.bot-secure/policy.json) desde $((Get-Location).Path). Arreglo: abre Claude Code en la raíz del workspace de IA" }
  $guard = Join-Path $ws '.claude\hooks\guard.mjs'
  $node = $null
  if ($env:BOT_SECURE_NODE) {
    if (Test-Path $env:BOT_SECURE_NODE) { $node = $env:BOT_SECURE_NODE } else { Fail "BOT_SECURE_NODE=$($env:BOT_SECURE_NODE) no existe; la guarda bloquea. Arreglo: bot-secure doctor" }
  }
  $local = Join-Path $ws '.bot-secure\local.json'
  if (-not $node -and (Test-Path $local)) {
    try { $j = Get-Content -Raw $local | ConvertFrom-Json; if ($j.node -and (Test-Path $j.node)) { $node = $j.node } } catch { }
  }
  if (-not $node) { $c = Get-Command node -ErrorAction SilentlyContinue; if ($c) { $node = $c.Source } }
  if (-not $node) {
    foreach ($c in @("$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe", "$env:APPDATA\nvm\current\node.exe", "$env:LOCALAPPDATA\Volta\bin\node.exe", "$env:APPDATA\fnm\aliases\default\node.exe")) {
      if ($c -and (Test-Path $c)) { $node = $c; break }
    }
  }
  if (-not $node) { Fail "node no encontrado; la guarda bloquea (fail-closed). Arreglo: instala Node >= 20 y ejecuta 'bot-secure doctor'" }
  if (-not (Test-Path $guard)) { Fail "falta $guard; la guarda bloquea. Arreglo: bot-secure init" }
  $json = [Console]::In.ReadToEnd()
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $node
  $psi.Arguments = '"' + $guard + '" ' + $Event
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.WorkingDirectory = (Get-Location).Path
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.StandardInput.Write($json); $p.StandardInput.Close()
  $out = $p.StandardOutput.ReadToEnd(); $err = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if ($out) { [Console]::Out.Write($out) }
  if ($err) { [Console]::Error.Write($err) }
  exit $p.ExitCode
} catch {
  Fail "error del lanzador: $($_.Exception.Message). Arreglo: bot-secure doctor"
}
