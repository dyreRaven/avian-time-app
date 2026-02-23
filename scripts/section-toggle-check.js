#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const nodeBin = process.execPath;

const cases = [
  {
    name: 'clock only',
    env: 'clock',
    expected: { time: true, payroll: false, shipments: false }
  },
  {
    name: 'payroll + shipments',
    env: 'payroll,shipments',
    expected: { time: false, payroll: true, shipments: true }
  },
  {
    name: 'all',
    env: 'all',
    expected: { time: true, payroll: true, shipments: true }
  },
  {
    name: 'blank defaults',
    env: '',
    expected: { time: true, payroll: true, shipments: true }
  },
  {
    name: 'invalid input fallback',
    env: 'not-a-section',
    expected: { time: true, payroll: true, shipments: true }
  }
];

const nodeCode = "const cfg = require('./lib/config'); console.log(JSON.stringify(cfg.SECTION_FEATURES));";
let failCount = 0;

function parseConfig(enabledSections) {
  const { status, stdout, stderr } = spawnSync(nodeBin, ['-e', nodeCode], {
    cwd: rootDir,
    env: { ...process.env, ENABLED_SECTIONS: enabledSections },
    encoding: 'utf8'
  });

  if (status !== 0) {
    throw new Error(`Configuration load failed for ENABLED_SECTIONS=${enabledSections || '<empty>'}: ${stderr || stdout}`.trim());
  }

  return JSON.parse((stdout || '').trim());
}

function isEqual(a, b) {
  return a.time === b.time && a.payroll === b.payroll && a.shipments === b.shipments;
}

cases.forEach(({ name, env, expected }) => {
  const actual = parseConfig(env);
  const ok = isEqual(actual, expected);

  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  if (!ok) {
    failCount += 1;
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
});

if (failCount > 0) {
  console.error(`section toggle smoke check failed (${failCount} case(s)).`);
  process.exitCode = 1;
} else {
  console.log('section toggle smoke check passed.');
}
