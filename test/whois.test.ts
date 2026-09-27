import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import { HostInfoError, whois } from '../src/index.ts';

type Vcard = [string, Record<string, unknown>, string, unknown][];
const vcard = (props: Vcard) => ['vcard', [['version', {}, 'text', '4.0'], ...props]];

// Trimmed from rdap.arin.net/registry/ip/8.8.8.8
const ARIN = {
  objectClassName: 'ip network',
  handle: 'NET-8-8-8-0-2',
  startAddress: '8.8.8.0',
  endAddress: '8.8.8.255',
  ipVersion: 'v4',
  name: 'GOGL',
  type: 'DIRECT ALLOCATION',
  parentHandle: 'NET-8-0-0-0-0',
  status: ['active'],
  port43: 'whois.arin.net',
  cidr0_cidrs: [{ v4prefix: '8.8.8.0', length: 24 }],
  events: [
    { eventAction: 'last changed', eventDate: '2023-12-28T17:24:56-05:00' },
    { eventAction: 'registration', eventDate: '2023-12-28T17:24:33-05:00' },
  ],
  entities: [
    {
      handle: 'GOGL',
      roles: ['registrant'],
      vcardArray: vcard([
        ['fn', {}, 'text', 'Google LLC'],
        ['adr', { label: '1600 Amphitheatre Parkway\nMountain View\nCA' }, 'text', ['', '', '']],
        ['kind', {}, 'text', 'org'],
      ]),
      entities: [
        {
          handle: 'ABUSE5250-ARIN',
          roles: ['abuse'],
          vcardArray: vcard([
            ['fn', {}, 'text', 'Abuse'],
            ['kind', {}, 'text', 'group'],
            ['email', {}, 'text', 'network-abuse@google.com'],
            ['tel', { type: ['work', 'voice'] }, 'text', '+1-650-253-0000'],
          ]),
        },
      ],
    },
  ],
};

// RIPE repeats a contact per role and lists its maintainer as a registrant.
const RIPE = {
  objectClassName: 'ip network',
  handle: '193.0.0.0 - 193.0.7.255',
  name: 'RIPE-NCC',
  country: 'NL',
  port43: 'whois.ripe.net',
  entities: [
    { handle: 'OPS4-RIPE', roles: ['technical'], vcardArray: vcard([['fn', {}, 'text', 'Ops']]) },
    {
      handle: 'RIPE-NCC-MNT',
      roles: ['registrant'],
      vcardArray: vcard([['kind', {}, 'text', 'individual']]),
    },
    {
      handle: 'ORG-RIEN1-RIPE',
      roles: ['registrant'],
      vcardArray: vcard([
        ['fn', {}, 'text', 'RIPE NCC'],
        ['kind', {}, 'text', 'org'],
      ]),
    },
    {
      handle: 'OPS4-RIPE',
      roles: ['abuse'],
      vcardArray: vcard([['email', {}, 'text', 'abuse@ripe.net']]),
    },
  ],
};

function mockFetch(body: unknown, init: ResponseInit = {}) {
  return mock.method(globalThis, 'fetch', async () =>
    Response.json(body, { status: 200, ...init }),
  );
}

afterEach(() => {
  mock.restoreAll();
});

test('summarizes an ARIN network', async () => {
  const fetchMock = mockFetch(ARIN);
  const info = await whois('8.8.8.8');
  assert.equal(
    String(fetchMock.mock.calls[0]!.arguments[0]),
    'https://rdap.arin.net/registry/ip/8.8.8.8',
  );
  assert.deepEqual(
    { ...info, contacts: undefined },
    {
      ip: '8.8.8.8',
      handle: 'NET-8-8-8-0-2',
      name: 'GOGL',
      type: 'DIRECT ALLOCATION',
      parentHandle: 'NET-8-0-0-0-0',
      country: null,
      startAddress: '8.8.8.0',
      endAddress: '8.8.8.255',
      cidrs: ['8.8.8.0/24'],
      status: ['active'],
      organization: 'Google LLC',
      abuseEmail: 'network-abuse@google.com',
      registered: '2023-12-28T17:24:33-05:00',
      updated: '2023-12-28T17:24:56-05:00',
      registry: 'whois.arin.net',
      contacts: undefined,
    },
  );
  assert.deepEqual(info.contacts[1], {
    handle: 'ABUSE5250-ARIN',
    roles: ['abuse'],
    kind: 'group',
    name: 'Abuse',
    org: null,
    email: 'network-abuse@google.com',
    phone: '+1-650-253-0000',
    address: null,
  });
  assert.equal(info.contacts[0]!.address, '1600 Amphitheatre Parkway\nMountain View\nCA');
});

test('merges repeated contacts and prefers the org registrant', async () => {
  mockFetch(RIPE);
  const info = await whois('193.0.6.139');
  assert.equal(info.organization, 'RIPE NCC');
  assert.equal(info.abuseEmail, 'abuse@ripe.net');
  assert.equal(info.country, 'NL');
  assert.deepEqual(
    info.contacts.map((c) => [c.handle, c.roles]),
    [
      ['OPS4-RIPE', ['technical', 'abuse']],
      ['RIPE-NCC-MNT', ['registrant']],
      ['ORG-RIEN1-RIPE', ['registrant']],
    ],
  );
});

test('accepts IPv6 and a custom endpoint', async () => {
  const fetchMock = mockFetch(ARIN);
  await whois('2001:4860::1', { endpoint: 'https://rdap.example/ip' });
  assert.equal(
    String(fetchMock.mock.calls[0]!.arguments[0]),
    'https://rdap.example/ip/2001%3A4860%3A%3A1',
  );
});

test('rejects things that are not IP addresses', async () => {
  const fetchMock = mockFetch(ARIN);
  await assert.rejects(whois('example.com'), TypeError);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('reports HTTP errors and non-network responses', async () => {
  mockFetch({ errorCode: 404 }, { status: 404 });
  await assert.rejects(whois('8.8.8.8'), { name: 'HostInfoError', message: /HTTP 404/ });
  mock.restoreAll();
  mockFetch({ objectClassName: 'autnum' });
  await assert.rejects(whois('8.8.8.8'), HostInfoError);
});

test('live whois against rdap.arin.net', { skip: !process.env.LIVE_TEST }, async () => {
  const info = await whois('8.8.8.8');
  assert.equal(info.organization, 'Google LLC');
  assert.equal(info.registry, 'whois.arin.net');
});
