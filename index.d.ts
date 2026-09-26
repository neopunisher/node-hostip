export interface LookupOptions {
  /**
   * Milliseconds before the request is aborted. Ignored when `signal` is
   * provided. Set to 0 to disable. Default: 10000.
   */
  timeout?: number;
  /** Abort the request yourself; overrides `timeout`. */
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
  /** ISO-ish two-letter country code; "XX" when unknown. */
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
}

export type LookupCallback = (error: Error | null, result?: HostInfo) => void;

export class HostInfoError extends Error {
  name: 'HostInfoError';
}

/**
 * Geocode an IP address with the free hostip.info API. Omit `ip` to look up
 * the caller's own public address. Returns a Promise unless a callback is
 * given.
 */
export function lookup(ip?: string, options?: LookupOptions): Promise<HostInfo>;
export function lookup(options: LookupOptions): Promise<HostInfo>;
export function lookup(callback: LookupCallback): void;
export function lookup(ip: string | undefined, callback: LookupCallback): void;
export function lookup(ip: string | undefined, options: LookupOptions, callback: LookupCallback): void;

declare const hostinfo: {
  lookup: typeof lookup;
  HostInfoError: typeof HostInfoError;
};
export default hostinfo;
