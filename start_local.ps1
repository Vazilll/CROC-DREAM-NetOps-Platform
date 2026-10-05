# CROC DREAM NetOps Platform - Local Standalone Startup Script
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "🚀 Starting CROC DREAM NetOps Platform Locally" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

$root = $PSScriptRoot
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"

# 1. Determine optimal Python runtime
$pythonCmd = "python"
if (Get-Command uv -ErrorAction SilentlyContinue) {
    $pythonCmd = "uv run python"
} elseif (Test-Path "$root\.venv\Scripts\python.exe") {
    $pythonCmd = "& '$root\.venv\Scripts\python.exe'"
} elseif (Test-Path "C:\vazus\.venv\Scripts\python.exe") {
    $pythonCmd = "& 'C:\vazus\.venv\Scripts\python.exe'"
}

Write-Host "Using Python launcher: $pythonCmd" -ForegroundColor Gray

# 2. Start Backend API
Write-Host "1. Starting Backend API (FastAPI + SQLite + In-process Beat Sync)..." -ForegroundColor Yellow
$backendJob = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$backendDir'; $pythonCmd run_local.py" -PassThru

Start-Sleep -Seconds 2

# 3. Start Frontend Web UI
Write-Host "2. Starting Frontend Web UI (Vite + React)..." -ForegroundColor Yellow
$frontendJob = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$frontendDir'; npm run dev -- --host 127.0.0.1 --port 5173" -PassThru

Start-Sleep -Seconds 2

# 4. Open in Default Browser
Write-Host "3. Opening Browser at http://127.0.0.1:5173 ..." -ForegroundColor Green
Start-Process "http://127.0.0.1:5173"

Write-Host ""
Write-Host "✅ CROC DREAM NetOps Platform is running!" -ForegroundColor Green
Write-Host "• Frontend UI: http://127.0.0.1:5173"
Write-Host "• Backend API & Swagger: http://127.0.0.1:8000/docs"
Write-Host "• System Health Doctor: $pythonCmd scripts/doctor.py"
Write-Host "• Default Tokens: dev-owner-token, dev-admin-token, dev-operator-token, dev-viewer-token"
Write-Host "==================================================" -ForegroundColor Cyan
