# Rawad Tech Captive Portal - Windows Installer
$ErrorActionPreference = "Stop"
$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

Write-Host "=== Rawad Tech Captive Portal - Windows Installer ===" -ForegroundColor Cyan

Write-Host "[1/4] Running database migrations..."
node (Join-Path $RootDir "database\migrations\migrate.mjs")

Write-Host "[2/4] Building backend..."
Push-Location (Join-Path $RootDir "backend")
npm ci; npm run build
Pop-Location

Write-Host "[3/4] Building guest-portal..."
Push-Location (Join-Path $RootDir "frontend\guest-portal")
npm ci; npm run build
Pop-Location

Write-Host "[4/4] Building admin-dashboard..."
Push-Location (Join-Path $RootDir "frontend\admin-dashboard")
npm ci; npm run build
Pop-Location

Write-Host "=== Installation Complete ===" -ForegroundColor Green
