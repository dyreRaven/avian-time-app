#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extractFunctionSource(source, signature) {
  const start = source.indexOf(signature);
  if (start === -1) {
    throw new Error(`Could not find function signature: ${signature}`);
  }
  const bodyStart = source.indexOf('{', start);
  if (bodyStart === -1) {
    throw new Error('Could not find function body start.');
  }
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) {
      return source.slice(start, i + 1);
    }
  }
  throw new Error('Could not find function body end.');
}

function makeContext() {
  const captures = [];
  const ctx = {
    captures,
    console,
    URL,
    Headers,
    window: { location: { origin: 'https://example.test' } },
    kaDeviceId: 'device-123',
    kaStartEmployeeId: null,
    kaLoadCsrfToken: () => null,
    kaStoreCsrfToken: () => {},
    kaGetDeviceSecret: () => 'secret-abc',
    kaAdminAuthId: () => 99,
    fetch: async (url, options) => {
      captures.push({ url, options });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        json: async () => ({ ok: true })
      };
    }
  };
  vm.createContext(ctx);
  return ctx;
}

async function run() {
  const kioskAdminPath = path.join(__dirname, '..', 'public', 'kiosk-admin.js');
  const source = fs.readFileSync(kioskAdminPath, 'utf8');
  const fnSource = extractFunctionSource(
    source,
    'async function fetchJSON(url, options = {})'
  );

  const ctx = makeContext();
  vm.runInContext(`${fnSource}\nthis.fetchJSON = fetchJSON;`, ctx);

  await ctx.fetchJSON('/api/shipments/42/comments/7', { method: 'DELETE' });
  const deleteCall = ctx.captures[0];
  assert(deleteCall, 'Expected a DELETE capture.');
  assert(
    String(deleteCall.url).includes('employee_id=99'),
    `DELETE shipment comment request must include employee_id auth query. Got: ${deleteCall.url}`
  );

  await ctx.fetchJSON('/api/shipments/42/comments', { method: 'GET' });
  const getCall = ctx.captures[1];
  assert(getCall, 'Expected a GET capture.');
  assert(
    String(getCall.url).includes('employee_id=99'),
    `GET shipment comments request must include employee_id auth query. Got: ${getCall.url}`
  );

  await ctx.fetchJSON('/api/shipments/42/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'hello' })
  });
  const postCall = ctx.captures[2];
  assert(postCall, 'Expected a POST capture.');
  const postBody = JSON.parse(String(postCall.options && postCall.options.body || '{}'));
  assert.strictEqual(
    postBody.employee_id,
    99,
    'POST shipment comment request must include employee_id in JSON body.'
  );
  assert.strictEqual(
    postBody.device_id,
    'device-123',
    'POST shipment comment request must include device_id in JSON body.'
  );
  assert.strictEqual(
    postBody.device_secret,
    'secret-abc',
    'POST shipment comment request must include device_secret in JSON body.'
  );

  process.stdout.write('kiosk comment auth checks passed\n');
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
