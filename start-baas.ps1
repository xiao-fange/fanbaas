# FanBaaS Start Script - by YaiYai (WeiXin: XiaoFanPingFan)
# ============================================================

chcp 65001 | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ROOT = "E:\FlyEnv-Data"

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Write-Warn($msg) { Write-Host "  [SKIP] $msg" -ForegroundColor Yellow }

function Wait-Port($port, $timeout = 15) {
    $deadline = (Get-Date).AddSeconds($timeout)
    while ((Get-Date) -lt $deadline) {
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $tcp.Connect("127.0.0.1", $port)
            $tcp.Close()
            return $true
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Is-Running($name) {
    return $null -ne (Get-Process -Name $name -ErrorAction SilentlyContinue)
}

Write-Host ""
Write-Host "  FanBaaS Starting..." -ForegroundColor Cyan
Write-Host "  by YaiYai | WeiXin: XiaoFanPingFan" -ForegroundColor DarkCyan
Write-Host ""

# 1. PostgreSQL
Write-Step "PostgreSQL 15"
if (Is-Running "postgres") {
    Write-Warn "PostgreSQL already running"
} else {
    try {
        & "$ROOT\app\postgresql-15.17\pgsql\bin\pg_ctl.exe" `
            -D "$ROOT\server\postgresql\postgresql15" `
            -l "$ROOT\server\postgresql\postgresql15\pg.log" `
            start | Out-Null
        if (Wait-Port 5432 20) {
            Write-OK "PostgreSQL started (port 5432)"
        } else {
            Write-Fail "PostgreSQL timeout - check: server\postgresql\postgresql15\pg.log"
        }
    } catch {
        Write-Fail "PostgreSQL failed: $($_.Exception.Message)"
    }
}

# 2. Redis
Write-Step "Redis 7.2.13"
if (Is-Running "redis-server") {
    Write-Warn "Redis already running"
} else {
    try {
        $redisDir = "$ROOT\app\redis-7.2.13\Redis-7.2.13-Windows-x64-msys2"
        Start-Process -FilePath "$redisDir\redis-server.exe" `
            -ArgumentList "pws-app-redis-7.conf" `
            -WorkingDirectory $redisDir `
            -WindowStyle Hidden `
            -RedirectStandardOutput "$ROOT\server\redis\redis-start-out.log" `
            -RedirectStandardError  "$ROOT\server\redis\redis-start-error.log"
        if (Wait-Port 6379 10) {
            Write-OK "Redis started (port 6379)"
        } else {
            Write-Fail "Redis timeout - check: server\redis\redis-start-error.log"
        }
    } catch {
        Write-Fail "Redis failed: $($_.Exception.Message)"
    }
}

# 3. MinIO
Write-Step "MinIO"
if (Is-Running "minio") {
    Write-Warn "MinIO already running"
} else {
    try {
        $p = Start-Process -FilePath "$ROOT\app\minio\minio.exe" `
            -ArgumentList "server `"$ROOT\server\minio\data`"" `
            -WorkingDirectory "$ROOT\app\minio" `
            -WindowStyle Hidden `
            -PassThru `
            -RedirectStandardOutput "$ROOT\server\minio\minio-start-out.log" `
            -RedirectStandardError  "$ROOT\server\minio\minio-start-error.log"
        $p.Id | Out-File "$ROOT\server\minio\minio.pid" -Encoding ascii
        if (Wait-Port 9000 15) {
            Write-OK "MinIO started (port 9000, console 9001)"
        } else {
            Write-Fail "MinIO timeout - check: server\minio\minio-start-error.log"
        }
    } catch {
        Write-Fail "MinIO failed: $($_.Exception.Message)"
    }
}

# 4. Caddy
Write-Step "Caddy 2.10.2"
if (Is-Running "caddy") {
    Write-Warn "Caddy already running"
} else {
    try {
        Start-Process -FilePath "$ROOT\app\caddy-2.10.2\caddy.exe" `
            -ArgumentList "start --config `"$ROOT\server\caddy\Caddyfile`" --pidfile `"$ROOT\server\caddy\caddy.pid`" --watch" `
            -WorkingDirectory "$ROOT\app\caddy-2.10.2" `
            -WindowStyle Hidden `
            -RedirectStandardOutput "$ROOT\server\caddy\caddy-start-out.log" `
            -RedirectStandardError  "$ROOT\server\caddy\caddy-start-error.log"
        if (Wait-Port 8080 10) {
            Write-OK "Caddy started (port 8080)"
        } else {
            Write-Fail "Caddy timeout - check: server\caddy\caddy-start-error.log"
        }
    } catch {
        Write-Fail "Caddy failed: $($_.Exception.Message)"
    }
}

# 5. Cloudflare Tunnel
Write-Step "Cloudflare Tunnel"
if (Is-Running "cloudflared") {
    Write-Warn "Cloudflare Tunnel already running"
} else {
    try {
        $cfToken = "eyJhIjoiMTNlYzJjNjQ1MjE4MmIyYTM2YmUxMGEyZTFkMmRlYTIiLCJ0IjoiNzUxNzI4OTgtMjZhZi00NTIyLWI1MTgtOTYzYThlMDU2NGZmIiwicyI6Ik4ySXlNREF5WW1ZdE56UXdPQzAwWldaakxXRmhNR1l0T1dNM01XRmpaalpsT0RJMiJ9"
        Start-Process -FilePath "$ROOT\app\cloudflared\2025.11.1\cloudflared.exe" `
            -ArgumentList "tunnel run --token $cfToken" `
            -WindowStyle Hidden `
            -RedirectStandardOutput "$ROOT\server\cloudflared-out.log" `
            -RedirectStandardError  "$ROOT\server\cloudflared-error.log"
        Start-Sleep -Seconds 3
        if (Is-Running "cloudflared") {
            Write-OK "Cloudflare Tunnel started"
        } else {
            Write-Fail "Cloudflare Tunnel failed - check: server\cloudflared-error.log"
        }
    } catch {
        Write-Fail "Cloudflare Tunnel failed: $($_.Exception.Message)"
    }
}

# 6. FanBaaS API
Write-Step "FanBaaS API"
$apiRunning = Get-WmiObject Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*api*index.js*" }
if ($apiRunning) {
    Write-Warn "API already running"
} else {
    try {
        $p = Start-Process -FilePath "$ROOT\app\nodejs\v22.18.0\node.exe" `
            -ArgumentList "index.js" `
            -WorkingDirectory "$ROOT\api" `
            -WindowStyle Hidden `
            -PassThru `
            -RedirectStandardOutput "$ROOT\api\combined.log" `
            -RedirectStandardError  "$ROOT\api\error.log"
        $p.Id | Out-File "$ROOT\api\api.pid" -Encoding ascii
        if (Wait-Port 3001 20) {
            Write-OK "API started (port 3001)"
        } else {
            Write-Fail "API timeout - check: api\error.log"
        }
    } catch {
        Write-Fail "API failed: $($_.Exception.Message)"
    }
}

Write-Host ""
Write-Host "  ============================================" -ForegroundColor DarkCyan
Write-Host "  FanBaaS is ready!" -ForegroundColor Green
Write-Host "  Home:    http://localhost:8080" -ForegroundColor Cyan
Write-Host "  Console: http://localhost:8080/console" -ForegroundColor Cyan
Write-Host "  API:     http://localhost:3001/health" -ForegroundColor Cyan
Write-Host "  MinIO:   http://localhost:9001" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor DarkCyan
Write-Host ""
