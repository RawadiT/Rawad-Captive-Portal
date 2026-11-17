import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

test('Local assets & offline readiness: no external CDN links in Guest Portal or HotSpot', () => {
  const filesToCheck = [
    'hotspot/login.html',
    'hotspot/status.html',
    'hotspot/logout.html',
    'hotspot/error.html',
    'hotspot/assets/style.css',
    'frontend/guest-portal/src/app/globals.css',
    'frontend/guest-portal/src/app/layout.tsx',
  ];

  for (const rel of filesToCheck) {
    const content = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.equal(content.includes('fonts.googleapis.com'), false, `${rel} must not load external Google Fonts`);
    assert.equal(content.includes('cdn.'), false, `${rel} must not load external CDN`);
  }

  assert.ok(fs.existsSync(path.join(root, 'hotspot/assets/logo.png')));
  assert.ok(fs.existsSync(path.join(root, 'hotspot/assets/fonts/cairo-arabic.woff2')));
  assert.ok(fs.existsSync(path.join(root, 'frontend/guest-portal/public/logo.png')));
  assert.ok(fs.existsSync(path.join(root, 'frontend/guest-portal/public/fonts/cairo-arabic.woff2')));
  assert.ok(fs.existsSync(path.join(root, 'frontend/admin-dashboard/public/logo.png')));
});

test('RTL, viewport, and reduced-motion accessibility checks', () => {
  const layout = fs.readFileSync(path.join(root, 'frontend/guest-portal/src/app/layout.tsx'), 'utf8');
  assert.ok(layout.includes('lang="ar"'));
  assert.ok(layout.includes('dir="rtl"'));

  const css = fs.readFileSync(path.join(root, 'frontend/guest-portal/src/app/globals.css'), 'utf8');
  assert.ok(css.includes('prefers-reduced-motion: reduce'));
});
