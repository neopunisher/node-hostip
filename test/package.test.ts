// Exercises the built package through its exports map, so run `npm run build` first.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';

test('ESM import resolves named and default exports', async () => {
  const mod = await import('hostinfo');
  assert.equal(typeof mod.lookup, 'function');
  assert.equal(mod.default.lookup, mod.lookup);
  for (const name of [
    'locate',
    'reverse',
    'trace',
    'whois',
    'hintFromHostname',
    'isPrivateIPv4',
  ] as const) {
    assert.equal(typeof mod[name], 'function', name);
    assert.equal(mod.default[name], mod[name], name);
  }
  assert.equal(new mod.HostInfoError('x').name, 'HostInfoError');
});

test('CommonJS require() still works', () => {
  const require = createRequire(import.meta.url);
  const { lookup, HostInfoError } = require('hostinfo');
  assert.equal(typeof lookup, 'function');
  assert.equal(typeof HostInfoError, 'function');
});

test('the CLI prints usage', () => {
  const require = createRequire(import.meta.url);
  const bin = require.resolve('hostinfo/package.json').replace(/package\.json$/, 'dist/cli.js');
  assert.match(execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' }), /^Usage:/);
});

test('the CLI serves MCP over stdio', () => {
  const require = createRequire(import.meta.url);
  const bin = require.resolve('hostinfo/package.json').replace(/package\.json$/, 'dist/cli.js');
  const input = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`;
  const [line] = execFileSync(process.execPath, [bin, 'mcp'], { input, encoding: 'utf8' }).trim().split('\n');
  const response = JSON.parse(line!);
  assert.equal(response.id, 1);
  assert.ok(response.result.tools.some((t: { name: string }) => t.name === 'locate'));
});
