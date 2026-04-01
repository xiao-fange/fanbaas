# FanBaaS Stop Script - by YaiYai (WeiXin: XiaoFanPingFan)
# ============================================================

chcp 65001 | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ROOT = "E:\FlyEnv-Data"

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [SKIP] $msg" -ForegroundColor Yellow }

function Stop-ByName($name, $label) {
    $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
    if (-not $procs) { Write-Warn "$label not running"; return }
    $procs | ForEach-Object { try { $_.Kill(); $_.WaitForExit(3000) } catch {} }
    Start-Sleep -Milliseconds 300
    if (Get-Process -Name $name -ErrorAction SilentlyContinue) {
        Stop-Process -Name $name -Force -ErrorAction SilentlyContinue
    }
    Write-OK "$label stopped"
}

Write-Host ""
Write-Host "  FanBaaS Stopping..." -ForegroundColor Cyan
Write-Host ""

# 1. FanBaaS API
Write-Step "FanBaaS API"
$pidFile = "$ROOT\api\api.pid"
if (Test-Path $pidFile) {
    $savedPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($savedPid) {
        Stop-Process -Id $savedPid -Force -ErrorAction SilentlyContinue
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
        Write-OK "API stopped (PID: $savedPid)"
    }
} else {
    $apiProc = Get-WmiObject Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -like "*api*index.js*" }
    if ($apiProc) {
        $apiProc | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Write-OK "API stopped"
    } else {
        Write-Warn "API not running"
    }
}

# 2. Caddy
Write-Step "Caddy"
if (Get-Process -Name "caddy" -ErrorAction SilentlyContinue) {
    try {
        & "$ROOT\app\caddy-2.10.2\caddy.exe" stop 2>$null
        Start-Sleep -Seconds 1
        if (-not (Get-Process -Name "caddy" -ErrorAction SilentlyContinue)) {
            Write-OK "Caddy stopped gracefully"
        } else {
            Stop-ByName "caddy" "Caddy"
        }
    } catch { Stop-ByName "caddy" "Caddy" }
    Remove-Item "$ROOT\server\caddy\caddy.pid" -Force -ErrorAction SilentlyContinue
} else {
    Write-Warn "Caddy not running"
}

# 3. Cloudflare Tunnel
Write-Step "Cloudflare Tunnel"
Stop-ByName "cloudflared" "Cloudflare Tunnel"

# 4. MinIO
Write-Step "MinIO"
$minioPid = "$ROOT\server\minio\minio.pid"
if (Test-Path $minioPid) {
    $savedPid = Get-Content $minioPid -ErrorAction SilentlyContinue
    if ($savedPid) {
        Stop-Process -Id $savedPid -Force -ErrorAction SilentlyContinue
        Remove-Item $minioPid -Force -ErrorAction SilentlyContinue
    }
}
Stop-ByName "minio" "MinIO"

# 5. Redis
Write-Step "Redis"
$redisCli = "$ROOT\app\redis-7.2.13\Redis-7.2.13-Windows-x64-msys2\redis-cli.exe"
if ((Get-Process -Name "redis-server" -ErrorAction SilentlyContinue) -and (Test-Path $redisCli)) {
    try {
        & $redisCli -p 6379 shutdown nosave 2>$null
        Start-Sleep -Seconds 1
        if (-not (Get-Process -Name "redis-server" -ErrorAction SilentlyContinue)) {
            Write-OK "Redis stopped gracefully"
        } else { Stop-ByName "redis-server" "Redis" }
    } catch { Stop-ByName "redis-server" "Redis" }
} else {
    Stop-ByName "redis-server" "Redis"
}

# 6. PostgreSQL
Write-Step "PostgreSQL"
if (Get-Process -Name "postgres" -ErrorAction SilentlyContinue) {
    try {
        & "$ROOT\app\postgresql-15.17\pgsql\bin\pg_ctl.exe" `
            -D "$ROOT\server\postgresql\postgresql15" stop -m fast 2>$null
        Start-Sleep -Seconds 2
        if (-not (Get-Process -Name "postgres" -ErrorAction SilentlyContinue)) {
            Write-OK "PostgreSQL stopped"
        } else { Stop-ByName "postgres" "PostgreSQL" }
    } catch { Stop-ByName "postgres" "PostgreSQL" }
} else {
    Write-Warn "PostgreSQL not running"
}

# Summary
Write-Host ""
$remaining = @("node","caddy","cloudflared","minio","redis-server","postgres") |
    Where-Object { Get-Process -Name $_ -ErrorAction SilentlyContinue }

Write-Host "  ============================================" -ForegroundColor DarkCyan
if ($remaining.Count -eq 0) {
    Write-Host "  All FanBaaS services stopped." -ForegroundColor Green
} else {
    Write-Host "  Still running: $($remaining -join ', ')" -ForegroundColor Yellow
    Write-Host "  Run: Stop-Process -Name '<name>' -Force" -ForegroundColor Yellow
}
Write-Host "  ============================================" -ForegroundColor DarkCyan
Write-Host ""
