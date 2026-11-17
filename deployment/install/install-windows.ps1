# Rawad Tech Captive Portal - Windows Installer
$ErrorActionPreference = "Stop"
$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

Write-Host "=== Rawad Tech Captive Portal - Windows Installer ===" -ForegroundColor Cyan

Write-Host "[1/2] Building backend..."
Push-Location (Join-Path $RootDir "backend")
npm ci; npm run build
Pop-Location

Write-Host "[2/2] Building frontend..."
Push-Location (Join-Path $RootDir "frontend")
npm ci; npm run build
Remove-Item -Recurse -Force ".next\cache" -ErrorAction SilentlyContinue
Pop-Location

Write-Host "=== Installation Complete. Apply supabase\schema.sql in Supabase SQL Editor, then configure deployment\.env ===" -ForegroundColor Green
