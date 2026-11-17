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

# 3. Supabase SQL, RouterOS scripts, HotSpot files, Deployment (NO secrets!) & Instructions
Copy-Item -Recurse -Force (Join-Path $RootDir "supabase") (Join-Path $OutDir "supabase")
Copy-Item -Recurse -Force (Join-Path $RootDir "routeros") (Join-Path $OutDir "routeros")
Copy-Item -Recurse -Force (Join-Path $RootDir "hotspot") (Join-Path $OutDir "hotspot")
Copy-Item -Recurse -Force (Join-Path $RootDir "deployment") (Join-Path $OutDir "deployment")
# Field-Test USB Package: remove any real .env* files AND production .env.example (keep ONLY .env.field-test.example)
Get-ChildItem -Path $OutDir -Recurse -Force -Filter ".env*" -File | Where-Object {
  $_.Name -ne ".env.field-test.example"
} | Remove-Item -Force -ErrorAction SilentlyContinue
# Remove any private TLS certificates or keys
Remove-Item -Recurse -Force (Join-Path $OutDir "deployment\tls\certs") -ErrorAction SilentlyContinue
Get-ChildItem -Path (Join-Path $OutDir "deployment") -Recurse -Force -Include "*.key","*.pem","*.crt","*.p12" -File | Remove-Item -Force -ErrorAction SilentlyContinue
Copy-Item -Force (Join-Path $RootDir "DEPLOYMENT.md") $OutDir
if (Test-Path (Join-Path $RootDir "FIELD_TEST.md")) {
  Copy-Item -Force (Join-Path $RootDir "FIELD_TEST.md") $OutDir
}

# 4. Create fail-safe Field-Test preflight & startup scripts (ONLY permitted mode in this package)
@'
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), 'deployment', '.env');
if (!fs.existsSync(envPath)) {
  console.error('[ABORT] deployment/.env not found! Copy deployment/.env.field-test.example to deployment/.env first.');
  process.exit(1);
}

const raw = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) continue;
  env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
}

const errors = [];
if (env.FIELD_TEST_MODE !== 'true') errors.push('FIELD_TEST_MODE must be true');
if (env.MIKROTIK_MODE !== 'mock') errors.push('MIKROTIK_MODE must be mock');
if (env.NODE_ENV !== 'development') errors.push('NODE_ENV must be development');
if (env.HOST !== '127.0.0.1') errors.push('HOST must be 127.0.0.1');
if (!env.SUPABASE_URL || /\.supabase\.(co|in)/i.test(env.SUPABASE_URL) || !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(env.SUPABASE_URL)) {
  errors.push('SUPABASE_URL must be a local test URL (127.0.0.1/localhost), never *.supabase.co');
}
if (env.MIKROTIK_HOST && env.MIKROTIK_HOST !== 'mock.local' && env.MIKROTIK_HOST !== '127.0.0.1') {
  errors.push('MIKROTIK_HOST must be mock.local or 127.0.0.1');
}

if (errors.length > 0) {
  console.error('[ABORT] Field-Test package refused to start due to unsafe configuration:');
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log('[FieldTest Preflight] Verified isolated Field-Test configuration.');
'@ | Set-Content (Join-Path $OutDir "field-test-preflight.mjs") -Encoding UTF8

@"
@echo off
cd /d %~dp0
node field-test-preflight.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo Starting Rawad Tech Captive Portal in ISOLATED FIELD-TEST MODE...
set RAWAD_FIELD_TEST_PACKAGE_LOCK=true
start "Rawad Backend (Field-Test)" cmd /k "cd /d %~dp0backend && set RAWAD_FIELD_TEST_PACKAGE_LOCK=true && node --env-file=..\deployment\.env dist/api/server.js"
start "Rawad Frontend (Field-Test)" cmd /k "cd /d %~dp0frontend && set PORT=3000 && set HOSTNAME=127.0.0.1 && set API_BACKEND_URL=http://127.0.0.1:4000 && node server.js"
"@ | Set-Content (Join-Path $OutDir "start-field-test.bat") -Encoding ASCII

@"
@echo off
call "%~dp0start-field-test.bat"
"@ | Set-Content (Join-Path $OutDir "start-windows.bat") -Encoding ASCII

$sizeBytes = (Get-ChildItem -Path $OutDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host ("USB Package ready at {0} — Total size: {1:N2} MB" -f $OutDir, ($sizeBytes / 1MB)) -ForegroundColor Green
