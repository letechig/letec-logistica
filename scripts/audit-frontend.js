const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'frontend', 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const failures = [];

function fail(message) {
  failures.push(message);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const inlineScripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(script => script.trim());

inlineScripts.forEach((script, index) => {
  try {
    new Function(script);
  } catch (error) {
    fail(`inline script ${index + 1} has invalid syntax: ${error.message}`);
  }
});

const ids = [...html.matchAll(/(?:^|[\s<])id\s*=\s*["']([^"']+)["']/gi)]
  .map(match => match[1]);
const duplicateIds = Object.entries(ids.reduce((acc, id) => {
  acc[id] = (acc[id] || 0) + 1;
  return acc;
}, {})).filter(([, count]) => count > 1);

if (duplicateIds.length) {
  fail(`duplicated ids: ${duplicateIds.map(([id, count]) => `${id} (${count}x)`).join(', ')}`);
}

const declaredFunctions = new Set(
  [...html.matchAll(/(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/g)]
    .map(match => match[1] || match[2])
);
const handlerAttrs = [...html.matchAll(/\bon(?:click|change|input|blur|submit)\s*=\s*["']([^"']+)["']/gi)]
  .map(match => match[1]);
const ignoredHandlerHeads = new Set(['if', 'event', 'document', 'setTimeout', 'this']);
const missingHandlers = new Set();

handlerAttrs.forEach(handler => {
  const head = handler.trim().match(/^([A-Za-z_$][\w$]*)\s*(?:\(|\.|=)/);
  if (!head) return;
  const name = head[1];
  if (!ignoredHandlerHeads.has(name) && !declaredFunctions.has(name)) missingHandlers.add(name);
});

if (missingHandlers.size) {
  fail(`inline handlers reference missing globals: ${[...missingHandlers].sort().join(', ')}`);
}

if (/AIza[0-9A-Za-z_-]{20,}/.test(html)) {
  fail('Google API key pattern found in frontend/index.html');
}

['app.js', 'api.js'].forEach(file => {
  const activePath = path.join(root, 'frontend', 'js', file);
  if (fs.existsSync(activePath)) {
    fail(`inactive legacy file still present in frontend/js: ${file}`);
  }
  const referenceRe = new RegExp(`(?:src|href)\\s*=\\s*["'][^"']*js/${escapeRegExp(file)}["']`, 'i');
  if (referenceRe.test(html)) {
    fail(`frontend/index.html still references js/${file}`);
  }
});

console.log(`frontend audit: ${inlineScripts.length} inline scripts, ${ids.length} ids, ${handlerAttrs.length} inline handlers`);

if (failures.length) {
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('frontend audit: OK');
