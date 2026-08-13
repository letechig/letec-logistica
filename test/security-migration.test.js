const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('migration de seguranca aplica RLS atual e automatico no schema public', () => {
  const sql = read('migration-security-enable-rls.sql');
  assert.match(sql, /ALTER TABLE %I\.%I ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE %I\.%I FROM anon, authenticated/i);
  assert.match(sql, /CREATE EVENT TRIGGER leteclog_ensure_public_tables_rls/i);
  assert.match(sql, /pg_event_trigger_ddl_commands\(\)/i);
  assert.match(sql, /JOIN pg_class AS relation/i);
  assert.doesNotMatch(sql, /command\.object_identity/i);
  assert.match(sql, /NOT ddl\.in_extension/i);
});

test('setup habilita RLS depois da ultima tabela criada', () => {
  const sql = read('supabase-setup.sql');
  const tableStatements = [...sql.matchAll(/^CREATE TABLE\s+/gim)];
  const lastCreateTable = tableStatements.at(-1)?.index ?? -1;
  const securityBlock = sql.indexOf('-- Seguranca da Data API');
  assert.ok(lastCreateTable >= 0);
  assert.ok(securityBlock > lastCreateTable);
  assert.match(sql.slice(securityBlock), /CREATE EVENT TRIGGER leteclog_ensure_public_tables_rls/i);
});

test('frontend nao consulta tabelas diretamente e backend nao aceita anon como fallback', () => {
  const mainFrontend = read('frontend/index.html');
  const portalFrontend = read('frontend/portal-tecnico.html');
  const server = read('server.js');
  const importer = read('scripts/import-client-base.js');

  assert.doesNotMatch(mainFrontend, /supabaseClient\s*\.\s*from\s*\(/);
  assert.doesNotMatch(portalFrontend, /supabaseClient\s*\.\s*from\s*\(/);
  assert.doesNotMatch(server, /SUPABASE_SERVICE_ROLE_KEY\s*\|\|\s*process\.env\.SUPABASE_ANON_KEY/);
  assert.doesNotMatch(importer, /SUPABASE_SERVICE_ROLE_KEY\s*\|\|\s*process\.env\.SUPABASE_ANON_KEY/);
});

test('bootstrap versionado nao contem senha nem hash estatico', () => {
  const bootstrap = read('bootstrap-internal-admin.sql');
  assert.doesNotMatch(bootstrap, /pbkdf2_sha256\$/i);
  assert.doesNotMatch(bootstrap, /Senha:\s*\S+/i);
});
