# Builds a lean, production-only USB transfer package in ./usb-package
$ErrorActionPreference = "Stop"
$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$OutDir = Join-Path $RootDir "usb-package"

if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# 1. Backend production build + production node_modules
$BeOut = Join-Path $OutDir "backend"
New-Item -ItemType Directory -Force -Path $BeOut | Out-Null
Copy-Item -Recurse -Force (Join-Path $RootDir "backend\dist") (Join-Path $BeOut "dist")
Copy-Item -Force (Join-Path $RootDir "backend\package.json") $BeOut
Copy-Item -Force (Join-Path $RootDir "backend\package-lock.json") $BeOut
Push-Location $BeOut
npm ci --omit=dev --no-audit --no-fund | Out-Null
Pop-Location

# 2. Frontend Next.js standalone production build (no devDependencies, no .next/cache)
$FeOut = Join-Path $OutDir "frontend"
New-Item -ItemType Directory -Force -Path "$FeOut\.next" | Out-Null
Copy-Item -Recurse -Force (Join-Path $RootDir "frontend\.next\standalone\*") $FeOut
Copy-Item -Recurse -Force (Join-Path $RootDir "frontend\.next\static") "$FeOut\.next\static"
Copy-Item -Recurse -Force (Join-Path $RootDir "frontend\public") "$FeOut\public"

# 3. Supabase SQL, RouterOS scripts, HotSpot files, Deployment & Instructions
Copy-Item -Recurse -Force (Join-Path $RootDir "supabase") (Join-Path $OutDir "supabase")
Copy-Item -Recurse -Force (Join-Path $RootDir "routeros") (Join-Path $OutDir "routeros")
Copy-Item -Recurse -Force (Join-Path $RootDir "hotspot") (Join-Path $OutDir "hotspot")
Copy-Item -Recurse -Force (Join-Path $RootDir "deployment") (Join-Path $OutDir "deployment")
Copy-Item -Force (Join-Path $RootDir "DEPLOYMENT.md") $OutDir

# 4. Create start scripts inside USB package
@"
@echo off
echo Starting Rawad Tech Captive Portal...
start "Rawad Backend" cmd /k "cd /d %~dp0backend && node dist/api/server.js"
start "Rawad Frontend" cmd /k "cd /d %~dp0frontend && set PORT=3000 && node server.js"
"@ | Set-Content (Join-Path $OutDir "start-windows.bat") -Encoding ASCII

$sizeBytes = (Get-ChildItem -Path $OutDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host ("USB Package ready at {0} — Total size: {1:N2} MB" -f $OutDir, ($sizeBytes / 1MB)) -ForegroundColor Green
