#!/usr/bin/env node
'use strict';

const DEFAULT_API_BASE_URL = 'https://letec-api.onrender.com';
const API_BASE_URL = String(process.env.LETEC_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '');
const today = new Date().toISOString().slice(0, 10);

const checks = [
  { name: 'Health', path: '/api/health', critical: true, validatePayload: payload => payload?.status === 'OK' },
  { name: 'Diagnostico operacional', path: '/api/diagnostics/operational', critical: true, validatePayload: payload => payload?.ok !== false },
  { name: 'Agenda / services', path: '/api/services?limit=5', critical: true },
  { name: 'Clientes', path: '/api/customers?page=1&limit=5', critical: true },
  { name: 'Tecnicos', path: '/api/technicians?active=true', critical: true },
  { name: 'Veiculos', path: '/api/veiculos?ativo=true', critical: true },
  { name: 'Checklists', path: `/api/checklists?date=${today}`, critical: true },
  { name: 'Eventos tecnicos', path: `/api/technician-events?date=${today}`, critical: true },
  { name: 'Recados tecnicos', path: `/api/technician-messages?date=${today}&unread=true`, critical: true },
  { name: 'Evolution API', path: '/api/evolution/status', critical: false, acceptedStatuses: [200, 503] }
];

function fail(message) {
  console.error(`\n[smoke] ${message}`);
  process.exitCode = 1;
}

function formatMs(startedAt) {
  return `${Date.now() - startedAt}ms`;
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (Array.isArray(payload)) return `${payload.length} item(ns)`;
  if (payload.status) return `status=${payload.status}`;
  if (payload.ok !== undefined) return `ok=${payload.ok}`;
  if (payload.connected !== undefined) return `connected=${payload.connected}`;
  if (payload.error) return `error=${payload.error}`;
  if (payload.items && Array.isArray(payload.items)) return `${payload.items.length}/${payload.total ?? payload.items.length} item(ns)`;
  return Object.keys(payload).slice(0, 5).join(',');
}

async function requestCheck(check) {
  const startedAt = Date.now();
  const url = `${API_BASE_URL}${check.path}`;
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch (error) { payload = { raw: text.slice(0, 160) }; }
    }
    const accepted = check.acceptedStatuses || [200];
    let ok = accepted.includes(response.status);
    if (ok && typeof check.validatePayload === 'function') {
      ok = !!check.validatePayload(payload);
    }
    return {
      ...check,
      ok,
      status: response.status,
      ms: formatMs(startedAt),
      payload,
      url
    };
  } catch (error) {
    return {
      ...check,
      ok: false,
      status: 0,
      ms: formatMs(startedAt),
      error: error.message || String(error),
      url
    };
  }
}

async function main() {
  if (typeof fetch !== 'function') {
    fail('Este smoke usa fetch nativo. Use Node 18+ ou rode em um ambiente com fetch global.');
    return;
  }

  console.log(`[smoke] Letec operacional`);
  console.log(`[smoke] API: ${API_BASE_URL}`);
  console.log(`[smoke] Data base: ${today}\n`);

  const results = [];
  for (const check of checks) {
    const result = await requestCheck(check);
    results.push(result);
    const icon = result.ok ? 'OK' : (check.critical ? 'FAIL' : 'WARN');
    const summary = result.error || summarizePayload(result.payload);
    console.log(`[${icon}] ${check.name} -> HTTP ${result.status} (${result.ms})${summary ? ` - ${summary}` : ''}`);
  }

  const failedCritical = results.filter(result => result.critical && !result.ok);
  const warnings = results.filter(result => !result.critical && !result.ok);
  const diagnostics = results.find(result => result.name === 'Diagnostico operacional')?.payload;

  if (diagnostics && typeof diagnostics === 'object') {
    const failedTables = Object.entries(diagnostics.checks || {})
      .filter(([, check]) => !check.ok)
      .map(([name]) => name);
    if (failedTables.length) {
      console.log(`\n[smoke] Aviso do diagnostico: tabelas com falha: ${failedTables.join(', ')}`);
    }
    if (Array.isArray(diagnostics.warnings) && diagnostics.warnings.length) {
      console.log(`[smoke] Warnings backend: ${diagnostics.warnings.join(' | ')}`);
    }
  }

  if (warnings.length) {
    console.log(`\n[smoke] ${warnings.length} aviso(s) opcional(is). Verifique se isso era esperado.`);
  }

  if (failedCritical.length) {
    fail(`${failedCritical.length} endpoint(s) critico(s) falharam: ${failedCritical.map(item => item.name).join(', ')}`);
    return;
  }

  console.log('\n[smoke] Todos os endpoints criticos responderam.');
}

main().catch(error => {
  fail(error.stack || error.message || String(error));
});
