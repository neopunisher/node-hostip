import assert from 'node:assert/strict';
import childProcess, { type ChildProcess } from 'node:child_process';
import dns from 'node:dns';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, mock, test } from 'node:test';

import { hintFromHostname, isPrivateIPv4, locate, reverse, trace } from '../src/index.ts';

// --- fakes -----------------------------------------------------------------

function hostipXml(ip: string, city: string, country: string, code: string, coords?: string): string {
  return `<?xml version="1.0" encoding="ISO-8859-1" ?>
<HostipLookupResultSet><gml:featureMember><Hostip>
<ip>${ip}</ip><gml:name>${city}</gml:name><countryName>${country}</countryName><countryAbbrev>${code}</countryAbbrev>
${coords ? `<gml:coordinates>${coords}</gml:coordinates>` : ''}
</Hostip></gml:featureMember></HostipLookupResultSet>`;
}

/** Answers hostip.info requests from a table keyed by IP; unknown IPs get "(Unknown city)". */
function mockHostip(table: Record<string, string> = {}) {
  return mock.method(globalThis, 'fetch', async (url: URL) => {
    const ip = url.searchParams.get('ip')!;
    const body = table[ip] ?? hostipXml(ip, '(Unknown city)', '(Unknown country)', 'XX');
    return new Response(Buffer.from(body, 'latin1'));
  });
}

function mockReverseDns(table: Record<string, string[]> = {}) {
  return mock.method(dns.promises.Resolver.prototype, 'reverse', async (ip: string) => {
    if (table[ip]) return table[ip];
    throw Object.assign(new Error(`getHostByAddr ENOTFOUND ${ip}`), { code: 'ENOTFOUND' });
  });
}

/** Fakes the traceroute process: prints `lines` one at a time, then exits with `code`. */
function mockSpawn(lines: string[], { code = 0, stderr = '' } = {}) {
  const children: Array<ChildProcess & { killed: boolean }> = [];
  const spawnMock = mock.method(childProcess, 'spawn', () => {
    const child = new EventEmitter() as ChildProcess & { killed: boolean };
    const stdout = new PassThrough();
    const err = new PassThrough();
    Object.assign(child, { stdout, stderr: err, killed: false });
    let closed = false;
    const close = (exit: number | null) => {
      if (closed) return;
      closed = true;
      stdout.end();
      err.end();
      setImmediate(() => child.emit('close', exit));
    };
    child.kill = () => {
      child.killed = true;
      close(null);
      return true;
    };
    (async () => {
      for (const line of lines) {
        await new Promise((r) => setImmediate(r));
        if (closed) return;
        stdout.write(`${line}\n`);
      }
      if (stderr) err.write(stderr);
      close(code);
    })();
    children.push(child);
    return child;
  });
  return { spawnMock, children };
}

afterEach(() => {
  mock.restoreAll();
});

// --- hintFromHostname ----------------------------------------------------------

test('hintFromHostname finds CLLI, airport, and city-name codes', () => {
  const cases: Array<[string, string | null]> = [
    ['108-254-2-1.lightspeed.hstntx.sbcglobal.net', 'Houston, TX'],
    ['ae-5.r21.lsanca07.us.bb.gin.ntt.net', 'Los Angeles, CA'],
    ['be2345.ccr41.fra03.atlas.cogentco.com', 'Frankfurt'],
    ['xe-0-0-1.core1.san-jose.example.net', 'San Jose, CA'],
    ['et-1.cr2.AMS1.EXAMPLE.NET.', 'Amsterdam'],
    ['dns.google', null],
    ['miami.com', null], // the registrable domain names the operator, not the place
    ['cpe-1-2-3-4.man.example.net', null], // "man" = metro area network, not Manchester
  ];
  for (const [hostname, city] of cases) {
    assert.equal(hintFromHostname(hostname)?.city ?? null, city, hostname);
  }
});

test('hintFromHostname prefers a CLLI code over an airport code', () => {
  const hint = hintFromHostname('lax-link.dllstx01.example.net');
  assert.equal(hint?.code, 'dllstx');
  assert.deepEqual(hint, {
    code: 'dllstx',
    city: 'Dallas, TX',
    countryCode: 'US',
    latitude: 32.78,
    longitude: -96.8,
  });
});

test('isPrivateIPv4 covers non-routable IPv4 space', () => {
  for (const ip of [
    '10.1.2.3',
    '172.20.0.1',
    '192.168.86.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '192.0.0.8',
    '198.18.0.1',
    '224.0.0.251',
    '255.255.255.255',
  ]) {
    assert.equal(isPrivateIPv4(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '198.20.0.1', '223.255.255.255', 'not-an-ip', '::1']) {
    assert.equal(isPrivateIPv4(ip), false, ip);
  }
});

// --- reverse ---------------------------------------------------------------

test('reverse returns PTR names, or [] when there are none', async () => {
  mockReverseDns({ '8.8.8.8': ['dns.google'] });
  assert.deepEqual(await reverse('8.8.8.8'), ['dns.google']);
  assert.deepEqual(await reverse('192.0.2.1'), []);
  await assert.rejects(reverse('nope'), TypeError);
});

// --- trace -----------------------------------------------------------------

const MAC_OUTPUT = [
  'traceroute to 1.1.1.1 (1.1.1.1), 30 hops max, 40 byte packets',
  ' 1  192.168.86.1  8.562 ms',
  ' 2  108.254.2.1  11.268 ms',
  ' 3  71.149.39.230  28.937 ms',
  ' 4  *',
  ' 5  1.1.1.1  15.247 ms',
];

test('trace parses hops and geolocates public ones', async () => {
  const { spawnMock } = mockSpawn(MAC_OUTPUT);
  const fetchMock = mockHostip({
    '71.149.39.230': hostipXml('71.149.39.230', 'Richardson, TX', 'UNITED STATES', 'US'),
  });
  mockReverseDns({ '108.254.2.1': ['108-254-2-1.lightspeed.hstntx.sbcglobal.net'] });

  const result = await trace('1.1.1.1');

  if (process.platform !== 'win32') {
    assert.deepEqual(spawnMock.mock.calls[0]!.arguments.slice(0, 2), [
      'traceroute',
      ['-n', '-q', '1', '-w', '1', '-m', '30', '1.1.1.1'],
    ]);
  }
  assert.equal(result.reached, true);
  assert.equal(result.stopped, 'reached');
  assert.deepEqual(
    result.hops.map((h) => [h.hop, h.ip, h.rtt]),
    [
      [1, '192.168.86.1', 8.562],
      [2, '108.254.2.1', 11.268],
      [3, '71.149.39.230', 28.937],
      [4, null, null],
      [5, '1.1.1.1', 15.247],
    ],
  );
  // Private and silent hops are never sent to hostip.info.
  const asked = fetchMock.mock.calls.map((c) => (c.arguments[0] as URL).searchParams.get('ip'));
  assert.deepEqual(asked.sort(), ['1.1.1.1', '108.254.2.1', '71.149.39.230']);
  assert.equal(result.hops[0]!.info, null);
  assert.equal(result.hops[1]!.hint?.city, 'Houston, TX');
  assert.equal(result.hops[2]!.info?.city, 'Richardson, TX');
  assert.equal(result.lastResponding?.ip, '1.1.1.1');
});

test('trace parses Windows tracert output', async () => {
  mockSpawn([
    'Tracing route to 8.8.8.8 over a maximum of 30 hops',
    '',
    '  1    <1 ms    <1 ms    <1 ms  192.168.1.254',
    '  2     *        *        *     Request timed out.',
    '  3    12 ms    11 ms    13 ms  8.8.8.8',
    '',
    'Trace complete.',
  ]);
  const result = await trace('8.8.8.8', { geolocate: false });
  assert.deepEqual(
    result.hops.map((h) => [h.hop, h.ip, h.rtt]),
    [
      [1, '192.168.1.254', 1],
      [2, null, null],
      [3, '8.8.8.8', 12],
    ],
  );
  assert.equal(result.reached, true);
});

test('trace gives up after a run of silent hops and reports where it dropped', async () => {
  const { children } = mockSpawn([
    ' 1  192.168.1.1  1.0 ms',
    ' 2  203.0.113.1  5.0 ms',
    ' 3  *',
    ' 4  *',
    ' 5  *',
    ' 6  *', // never read: we stop after three
  ]);
  const result = await trace('198.51.100.7', { giveUpAfter: 3, geolocate: false });
  assert.equal(children[0]!.killed, true);
  assert.equal(result.reached, false);
  assert.equal(result.stopped, 'gave-up');
  assert.equal(result.hops.length, 5);
  assert.equal(result.lastResponding?.ip, '203.0.113.1');
});

test('trace reports max-hops when traceroute runs out', async () => {
  mockSpawn([' 1  192.168.1.1  1.0 ms', ' 2  *']);
  const result = await trace('198.51.100.7', { geolocate: false });
  assert.equal(result.stopped, 'max-hops');
  assert.equal(result.reached, false);
});

test('trace rejects when traceroute is missing', async () => {
  mock.method(childProcess, 'spawn', () => {
    const child = new EventEmitter() as ChildProcess;
    Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    setImmediate(() => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })));
    return child;
  });
  await assert.rejects(trace('8.8.8.8'), /was not found/);
});

test('trace rejects when traceroute fails without output', async () => {
  mockSpawn([], { code: 1, stderr: 'traceroute: unknown host\n' });
  await assert.rejects(trace('8.8.8.8'), /unknown host/);
});

test('trace rejects non-IPv4 targets', async () => {
  const { spawnMock } = mockSpawn([]);
  await assert.rejects(trace('example.com'), TypeError);
  assert.equal(spawnMock.mock.callCount(), 0);
});

test('trace rejects with the reason when aborted', async () => {
  const { children } = mockSpawn(MAC_OUTPUT);
  const controller = new AbortController();
  const promise = trace('1.1.1.1', { signal: controller.signal, geolocate: false });
  controller.abort(new Error('stop'));
  await assert.rejects(promise, /stop/);
  assert.equal(children[0]!.killed, true);
});

// --- locate ----------------------------------------------------------------

test('locate uses hostip.info when it knows the city', async () => {
  mockHostip({ '8.8.8.8': hostipXml('8.8.8.8', 'Mountain View, CA', 'UNITED STATES', 'US', '-122.078,37.402') });
  mockReverseDns({ '8.8.8.8': ['dns.google'] });
  const result = await locate('8.8.8.8');
  assert.equal(result.source, 'hostip');
  assert.equal(result.city, 'Mountain View, CA');
  assert.equal(result.hostname, 'dns.google');
});

test('locate falls back to the hostname', async () => {
  mockHostip({ '108.254.2.1': hostipXml('108.254.2.1', '(Unknown city)', 'UNITED STATES', 'US') });
  mockReverseDns({ '108.254.2.1': ['108-254-2-1.lightspeed.hstntx.sbcglobal.net'] });
  const { spawnMock } = mockSpawn([]);
  const result = await locate('108.254.2.1', { trace: true });
  assert.deepEqual(result, {
    ip: '108.254.2.1',
    city: 'Houston, TX',
    country: 'UNITED STATES',
    countryCode: 'US',
    latitude: 29.76,
    longitude: -95.37,
    hostname: '108-254-2-1.lightspeed.hstntx.sbcglobal.net',
    source: 'hostname',
    via: null,
  });
  assert.equal(spawnMock.mock.callCount(), 0, 'no traceroute needed');
});

test('locate borrows the nearest located hop when asked to trace', async () => {
  mockSpawn([
    ' 1  192.168.1.1  1.0 ms',
    ' 2  108.254.2.1  5.0 ms',
    ' 3  71.149.39.230  9.0 ms',
    ' 4  32.130.19.178  12.0 ms',
    ' 5  32.130.20.13  14.0 ms',
  ]);
  mockHostip({
    '71.149.39.230': hostipXml('71.149.39.230', 'Richardson, TX', 'UNITED STATES', 'US'),
    '32.130.19.178': hostipXml('32.130.19.178', '(Unknown city)', 'UNITED STATES', 'US'),
    '32.130.20.13': hostipXml('32.130.20.13', '(Unknown city)', 'UNITED STATES', 'US'),
  });
  mockReverseDns({ '108.254.2.1': ['108-254-2-1.lightspeed.hstntx.sbcglobal.net'] });

  const result = await locate('32.130.20.13', { trace: { giveUpAfter: 2 } });
  assert.equal(result.source, 'traceroute');
  assert.equal(result.ip, '32.130.20.13');
  assert.equal(result.city, 'Richardson, TX');
  assert.equal(result.via?.hop, 3);
});

test('locate without trace reports source null when nothing is known', async () => {
  mockHostip();
  mockReverseDns();
  const { spawnMock } = mockSpawn([]);
  const result = await locate('198.51.100.7');
  assert.equal(result.source, null);
  assert.equal(result.city, null);
  assert.equal(spawnMock.mock.callCount(), 0);
});
