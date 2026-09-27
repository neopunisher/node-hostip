import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { PassThrough } from 'node:stream';

import { createMcpSession, serveMcp, type McpResponse } from '../src/mcp.ts';

afterEach(() => mock.restoreAll());

const request = (id: number, method: string, params?: object) => ({ jsonrpc: '2.0', id, method, params });

function result(response: McpResponse | null): any {
  assert.ok(response && 'result' in response, JSON.stringify(response));
  return response.result;
}

test('initialize negotiates the protocol version', async () => {
  const session = createMcpSession();
  const known = result(await session.handle(request(1, 'initialize', { protocolVersion: '2025-06-18' })));
  assert.equal(known.protocolVersion, '2025-06-18');
  assert.deepEqual(known.capabilities, { tools: {} });
  assert.equal(known.serverInfo.name, 'hostinfo');

  const unknown = result(await session.handle(request(2, 'initialize', { protocolVersion: '1999-01-01' })));
  assert.match(unknown.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(unknown.protocolVersion, '1999-01-01');
});

test('tools/list describes every tool as read-only', async () => {
  const { tools } = result(await createMcpSession().handle(request(1, 'tools/list')));
  assert.deepEqual(
    tools.map((t: { name: string }) => t.name),
    ['locate', 'traceroute', 'reverse_dns', 'whois', 'hostname_hint'],
  );
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.equal(tool.annotations.readOnlyHint, true, tool.name);
    assert.equal('run' in tool, false, tool.name);
  }
});

test('tools/call returns the result as JSON text', async () => {
  const res = result(
    await createMcpSession().handle(
      request(1, 'tools/call', { name: 'hostname_hint', arguments: { hostname: 'be2345.ccr41.fra03.atlas.cogentco.com' } }),
    ),
  );
  assert.equal(res.isError, false);
  assert.equal(JSON.parse(res.content[0].text).city, 'Frankfurt');
});

test('tool failures come back as isError results', async () => {
  const session = createMcpSession();
  const missing = result(await session.handle(request(1, 'tools/call', { name: 'whois', arguments: {} })));
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /"target" is required/);

  mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 503 }));
  const failed = result(await session.handle(request(2, 'tools/call', { name: 'whois', arguments: { target: '8.8.8.8' } })));
  assert.equal(failed.isError, true);
});

test('protocol errors', async () => {
  const session = createMcpSession();
  const unknownTool = await session.handle(request(1, 'tools/call', { name: 'nope' }));
  assert.ok(unknownTool && 'error' in unknownTool);
  assert.equal(unknownTool.error.code, -32602);

  const unknownMethod = await session.handle(request(2, 'resources/list'));
  assert.ok(unknownMethod && 'error' in unknownMethod);
  assert.equal(unknownMethod.error.code, -32601);

  assert.equal(await session.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('notifications/cancelled aborts an in-flight call', async () => {
  mock.method(globalThis, 'fetch', (_url: unknown, init: RequestInit) =>
    new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))),
  );
  const session = createMcpSession();
  const call = session.handle(request(7, 'tools/call', { name: 'whois', arguments: { target: '8.8.8.8' } }));
  await new Promise((r) => setImmediate(r));
  await session.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } });
  const res = result(await call);
  assert.equal(res.isError, true);
});

test('serveMcp speaks newline-delimited JSON', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const done = serveMcp({ input, output });
  input.write(`${JSON.stringify(request(1, 'ping'))}\n`);
  input.end('not json\n');
  await done;
  const lines = String(output.read()).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines, [
    { jsonrpc: '2.0', id: 1, result: {} },
    { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
  ]);
});
