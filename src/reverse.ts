import dns from 'node:dns';
import { isIP } from 'node:net';

import { HostInfoError } from './lookup.ts';

export interface ReverseOptions {
  /** Milliseconds before the DNS query gives up. Set to 0 for the system default. Default: 5000. */
  timeout?: number;
  /** Cancel the query yourself. */
  signal?: AbortSignal;
}

// Answers that just mean "this address has no PTR record".
const NO_RECORD = new Set(['ENOTFOUND', 'ENODATA', 'ESERVFAIL', 'ENONAME']);

/**
 * Reverse DNS: the hostnames (PTR records) registered for an IPv4 or IPv6
 * address. Resolves to an empty array when there are none.
 */
export async function reverse(ip: string, options: ReverseOptions = {}): Promise<string[]> {
  const { timeout = 5000, signal } = options;
  if (!isIP(ip)) {
    throw new TypeError(`Expected an IP address, got ${JSON.stringify(ip)}`);
  }
  signal?.throwIfAborted();

  const resolver = new dns.promises.Resolver({ timeout: timeout > 0 ? timeout : -1, tries: 1 });
  const cancel = (): void => resolver.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    return await resolver.reverse(ip);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code !== undefined && NO_RECORD.has(code)) return [];
    if (signal?.aborted) throw signal.reason;
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new HostInfoError(`Reverse DNS lookup for ${ip} failed: ${message}`, { cause });
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
