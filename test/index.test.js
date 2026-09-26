'use strict';

const assert = require('node:assert/strict');
const { test, mock, afterEach } = require('node:test');

const { lookup, HostInfoError } = require('../index.js');

function hostipXml(inner) {
  return [
    '<?xml version="1.0" encoding="ISO-8859-1" ?>',
    '<HostipLookupResultSet version="1.0.1" xmlns:gml="http://www.opengis.net/gml">',
    ' <gml:description>This is the Hostip Lookup Service</gml:description>',
    ' <gml:name>hostip</gml:name>',
    ' <gml:featureMember>',
    '  <Hostip>',
    inner,
    '  </Hostip>',
    ' </gml:featureMember>',
    '</HostipLookupResultSet>',
  ].join('\n');
}

const FOUND_XML = hostipXml(`
   <ip>8.8.8.8</ip>
   <gml:name>Mountain View, CA</gml:name>
   <countryName>UNITED STATES</countryName>
   <countryAbbrev>US</countryAbbrev>
   <ipLocation>
    <gml:pointProperty>
     <gml:Point srsName="http://www.opengis.net/gml/srs/epsg.xml#4326">
      <gml:coordinates>-122.078,37.402</gml:coordinates>
     </gml:Point>
    </gml:pointProperty>
   </ipLocation>
`);

const PRIVATE_XML = hostipXml(`
   <ip>192.168.1.1</ip>
   <gml:name>(Private Address)</gml:name>
   <countryName>(Private Address)</countryName>
   <countryAbbrev>XX</countryAbbrev>
`);

const UNKNOWN_CITY_XML = hostipXml(`
   <ip>203.0.113.5</ip>
   <gml:name>(Unknown city)</gml:name>
   <countryName>AUSTRALIA</countryName>
   <countryAbbrev>AU</countryAbbrev>
`);

function mockFetch(body, init = {}) {
  return mock.method(globalThis, 'fetch', async () => {
    // The real API serves ISO-8859-1
    return new Response(Buffer.from(body, 'latin1'), { status: 200, ...init });
  });
}

afterEach(() => {
  mock.restoreAll();
});

test('resolves city, country, and coordinates', async () => {
  const fetchMock = mockFetch(FOUND_XML);

  const result = await lookup('8.8.8.8');
  assert.deepEqual(result, {
    ip: '8.8.8.8',
    city: 'Mountain View, CA',
    country: 'UNITED STATES',
    countryCode: 'US',
    latitude: 37.402,
    longitude: -122.078,
  });

  const url = fetchMock.mock.calls[0].arguments[0];
  assert.equal(url.href, 'https://api.hostip.info/?ip=8.8.8.8');
});

test('normalizes private-address placeholders to null', async () => {
  mockFetch(PRIVATE_XML);
  const result = await lookup('192.168.1.1');
  assert.deepEqual(result, {
    ip: '192.168.1.1',
    city: null,
    country: null,
    countryCode: 'XX',
    latitude: null,
    longitude: null,
  });
});

test('handles a known country with unknown city', async () => {
  mockFetch(UNKNOWN_CITY_XML);
  const result = await lookup('203.0.113.5');
  assert.equal(result.city, null);
  assert.equal(result.country, 'AUSTRALIA');
  assert.equal(result.countryCode, 'AU');
  assert.equal(result.latitude, null);
});

test('omitting the ip queries the caller address', async () => {
  const fetchMock = mockFetch(FOUND_XML);
  await lookup();
  const url = fetchMock.mock.calls[0].arguments[0];
  assert.equal(url.href, 'https://api.hostip.info/');
});

test('decodes ISO-8859-1 bodies and XML entities', async () => {
  mockFetch(hostipXml(`
   <ip>203.0.113.9</ip>
   <gml:name>S\xe3o Paulo &amp; Region</gml:name>
   <countryName>BRAZIL</countryName>
   <countryAbbrev>BR</countryAbbrev>
`));
  const result = await lookup('203.0.113.9');
  assert.equal(result.city, 'São Paulo & Region');
});

test('rejects with HostInfoError on HTTP errors', async () => {
  mockFetch('oops', { status: 503 });
  await assert.rejects(lookup('8.8.8.8'), (error) => {
    assert.ok(error instanceof HostInfoError);
    assert.match(error.message, /HTTP 503/);
    return true;
  });
});

test('rejects with HostInfoError on malformed bodies', async () => {
  mockFetch('<html>not the api you expected</html>');
  await assert.rejects(lookup('8.8.8.8'), HostInfoError);
});

test('wraps network failures with the original cause', async () => {
  const boom = new TypeError('fetch failed');
  mock.method(globalThis, 'fetch', async () => {
    throw boom;
  });
  await assert.rejects(lookup('8.8.8.8'), (error) => {
    assert.ok(error instanceof HostInfoError);
    assert.equal(error.cause, boom);
    return true;
  });
});

test('supports the legacy callback style', (t, done) => {
  mockFetch(FOUND_XML);
  const returned = lookup('8.8.8.8', (error, result) => {
    assert.equal(error, null);
    assert.equal(result.countryCode, 'US');
    done();
  });
  assert.equal(returned, undefined);
});

test('callback receives errors as the first argument', (t, done) => {
  mockFetch('oops', { status: 500 });
  lookup('8.8.8.8', (error, result) => {
    assert.ok(error instanceof HostInfoError);
    assert.equal(result, undefined);
    done();
  });
});

test('accepts options without an ip', async () => {
  const fetchMock = mockFetch(FOUND_XML);
  await lookup({ endpoint: 'https://example.test/api' });
  const url = fetchMock.mock.calls[0].arguments[0];
  assert.equal(url.href, 'https://example.test/api');
});

test('live lookup against api.hostip.info', { skip: !process.env.LIVE_TEST }, async () => {
  const result = await lookup('8.8.8.8');
  assert.equal(result.ip, '8.8.8.8');
  assert.equal(result.countryCode, 'US');
});
