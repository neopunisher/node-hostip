import { isIPv4 } from 'node:net';

import { isPrivateIPv4 } from './private.ts';

const DEFAULT_ENDPOINT = 'https://api.hostip.info/';
const DEFAULT_TIMEOUT = 10_000;

export interface LookupOptions {
  /**
   * Milliseconds before the request is aborted. Set to 0 to disable.
   * Default: 10000.
   */
  timeout?: number;
  /** Abort the request yourself. Combined with `timeout`; whichever fires first wins. */
  signal?: AbortSignal;
  /** Alternate API endpoint. Default: "https://api.hostip.info/". */
  endpoint?: string | URL;
}

export interface HostInfo {
  /** The IP address the API answered for. */
  ip: string | null;
  /** City name, or null when unknown or a private address. */
  city: string | null;
  /** Country name (upper case), or null when unknown. */
  country: string | null;
  /** ISO-ish two-letter country code, or null when unknown. */
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
}

export type LookupCallback = (error: Error | null, result?: HostInfo) => void;

export class HostInfoError extends Error {
  override name = 'HostInfoError' as const;
}

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function unescapeXml(text: string): string {
  return text.replace(
    /&(?:amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g,
    (match, dec?: string, hex?: string) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      return XML_ENTITIES[match] ?? match;
    },
  );
}

function extractField(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  if (!match) return null;
  const value = unescapeXml(match[1]!.trim());
  return value === '' ? null : value;
}

// The API reports unknowns as placeholders like "(Unknown city)" or
// "(Private Address)", and an unknown country code as "XX"; normalize those
// to null.
function known(value: string | null): string | null {
  return value?.startsWith('(') || value === 'XX' ? null : value;
}

function parseHostipXml(xml: string): HostInfo {
  const inner = /<Hostip>([\s\S]*?)<\/Hostip>/.exec(xml)?.[1];
  if (inner === undefined) {
    throw new HostInfoError('Unexpected response from hostip.info: missing <Hostip> element');
  }

  let latitude: number | null = null;
  let longitude: number | null = null;
  const coordinates = extractField(inner, 'gml:coordinates');
  if (coordinates !== null) {
    // hostip.info returns "longitude,latitude"
    const [lng, lat] = coordinates.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      latitude = lat!;
      longitude = lng!;
    }
  }

  return {
    ip: extractField(inner, 'ip'),
    city: known(extractField(inner, 'gml:name')),
    country: known(extractField(inner, 'countryName')),
    countryCode: known(extractField(inner, 'countryAbbrev')),
    latitude,
    longitude,
  };
}

async function lookupAsync(ip: string | undefined, options: LookupOptions): Promise<HostInfo> {
  const { timeout = DEFAULT_TIMEOUT, signal, endpoint = DEFAULT_ENDPOINT } = options;

  // hostip.info only knows IPv4 and answers anything else with a misleading
  // "(Private Address)", so reject bad input up front.
  if (ip !== undefined && !isIPv4(ip)) {
    throw new TypeError(`Expected an IPv4 address, got ${JSON.stringify(ip)}`);
  }

  // hostip.info can't place these, so skip the round trip.
  if (ip !== undefined && isPrivateIPv4(ip)) {
    return { ip, city: null, country: null, countryCode: null, latitude: null, longitude: null };
  }

  const url = new URL(endpoint);
  if (ip !== undefined) url.searchParams.set('ip', ip);

  const signals = [signal, timeout > 0 ? AbortSignal.timeout(timeout) : undefined].filter(
    (s): s is AbortSignal => s !== undefined,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'text/xml' },
      signal: signals.length > 0 ? AbortSignal.any(signals) : null,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new HostInfoError(`Request to hostip.info failed: ${message}`, { cause });
  }
  if (!response.ok) {
    throw new HostInfoError(`hostip.info responded with HTTP ${response.status}`);
  }

  // The API serves ISO-8859-1, which response.text() would mangle.
  const xml = new TextDecoder('iso-8859-1').decode(await response.arrayBuffer());
  return parseHostipXml(xml);
}

/**
 * Geocode an IPv4 address with the free hostip.info API. Omit `ip` to look up
 * the caller's own public address. Returns a Promise unless a callback is
 * given.
 */
export function lookup(ip?: string | null, options?: LookupOptions): Promise<HostInfo>;
export function lookup(options: LookupOptions): Promise<HostInfo>;
export function lookup(callback: LookupCallback): void;
export function lookup(ip: string | null | undefined, callback: LookupCallback): void;
export function lookup(
  ip: string | null | undefined,
  options: LookupOptions | undefined,
  callback: LookupCallback,
): void;
export function lookup(
  ip?: string | null | LookupOptions | LookupCallback,
  options?: LookupOptions | LookupCallback,
  callback?: LookupCallback,
): Promise<HostInfo> | void {
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

  const promise = lookupAsync(ip ?? undefined, options ?? {});
  if (typeof callback !== 'function') return promise;

  const cb = callback;
  // Call back outside the promise chain so an exception thrown by the
  // callback surfaces as-is instead of becoming an unhandled rejection.
  promise.then(
    (result) => process.nextTick(cb, null, result),
    (error: Error) => process.nextTick(cb, error),
  );
}
