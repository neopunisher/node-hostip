'use strict';

const DEFAULT_ENDPOINT = 'https://api.hostip.info/';
const DEFAULT_TIMEOUT = 10_000;

class HostInfoError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'HostInfoError';
  }
}

const XML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function unescapeXml(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g, (match, dec, hex) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return XML_ENTITIES[match];
  });
}

function extractField(xml, tag) {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  if (!match) return null;
  const value = unescapeXml(match[1].trim());
  return value === '' ? null : value;
}

function parseHostipXml(xml) {
  const block = /<Hostip>([\s\S]*?)<\/Hostip>/.exec(xml);
  if (!block) {
    throw new HostInfoError('Unexpected response from hostip.info: missing <Hostip> element');
  }
  const inner = block[1];

  let city = extractField(inner, 'gml:name');
  let country = extractField(inner, 'countryName');
  // The API reports unknowns as placeholders like "(Unknown city)" or
  // "(Private Address)"; normalize those to null.
  if (city !== null && city.startsWith('(')) city = null;
  if (country !== null && country.startsWith('(')) country = null;

  let latitude = null;
  let longitude = null;
  const coordinates = extractField(inner, 'gml:coordinates');
  if (coordinates !== null) {
    // hostip.info returns "longitude,latitude"
    const [lng, lat] = coordinates.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      latitude = lat;
      longitude = lng;
    }
  }

  return {
    ip: extractField(inner, 'ip'),
    city,
    country,
    countryCode: extractField(inner, 'countryAbbrev'),
    latitude,
    longitude,
  };
}

async function lookupAsync(ip, options) {
  const { timeout = DEFAULT_TIMEOUT, signal, endpoint = DEFAULT_ENDPOINT } = options;
  const url = new URL(endpoint);
  if (ip !== undefined && ip !== null) url.searchParams.set('ip', String(ip));

  let response;
  try {
    response = await fetch(url, {
      headers: { accept: 'text/xml' },
      signal: signal ?? (timeout > 0 ? AbortSignal.timeout(timeout) : undefined),
    });
  } catch (cause) {
    throw new HostInfoError(`Request to hostip.info failed: ${cause.message}`, { cause });
  }
  if (!response.ok) {
    throw new HostInfoError(`hostip.info responded with HTTP ${response.status}`);
  }

  // The API serves ISO-8859-1, which response.text() would mangle.
  const xml = new TextDecoder('iso-8859-1').decode(await response.arrayBuffer());
  return parseHostipXml(xml);
}

function lookup(ip, options, callback) {
  if (typeof ip === 'function') {
    callback = ip;
    ip = undefined;
    options = undefined;
  } else if (typeof options === 'function') {
    callback = options;
    options = undefined;
  }
  if (typeof ip === 'object' && ip !== null) {
    options = ip;
    ip = undefined;
  }

  const promise = lookupAsync(ip, options ?? {});
  if (typeof callback !== 'function') return promise;
  promise.then(
    (result) => callback(null, result),
    (error) => callback(error),
  );
  return undefined;
}

module.exports = { lookup, HostInfoError };
