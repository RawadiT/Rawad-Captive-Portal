import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

test('Local assets, zero SQLite, and exact Guest UI button label', () => {
  const pageTsx = fs.readFileSync(path.join(root, 'frontend/src/app/page.tsx'), 'utf8');
  assert.ok(pageTsx.includes('إنترنت مجاني لمدة 30 دقيقة'));
  assert.equal(pageTsx.includes('SUPABASE_SERVICE_ROLE_KEY'), false);

  const adminTsx = fs.readFileSync(path.join(root, 'frontend/src/app/admin/page.tsx'), 'utf8');
  assert.equal(adminTsx.includes('SUPABASE_SERVICE_ROLE_KEY'), false);

  assert.equal(fs.existsSync(path.join(root, 'database')), false, 'SQLite database folder must not exist');
  assert.ok(fs.existsSync(path.join(root, 'supabase/schema.sql')));
  assert.ok(fs.existsSync(path.join(root, 'frontend/public/logo.png')));
  assert.ok(fs.existsSync(path.join(root, 'frontend/public/fonts/cairo-arabic.woff2')));
});

test('RTL, viewport, and reduced-motion accessibility checks', () => {
  const layout = fs.readFileSync(path.join(root, 'frontend/src/app/layout.tsx'), 'utf8');
  assert.ok(layout.includes('lang="ar"'));
  assert.ok(layout.includes('dir="rtl"'));

  const css = fs.readFileSync(path.join(root, 'frontend/src/app/globals.css'), 'utf8');
  assert.ok(css.includes('prefers-reduced-motion: reduce'));
});
