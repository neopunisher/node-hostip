import childProcess from 'node:child_process';
import { isIPv4 } from 'node:net';
import { createInterface } from 'node:readline';

import { hintFromHostname, type LocationHint } from './hints.ts';
import { HostInfoError, lookup, type HostInfo } from './lookup.ts';
import { isPrivateIPv4 } from './private.ts';
import { reverse } from './reverse.ts';

export interface TraceOptions {
  /** Highest TTL to probe. Default: 30. */
  maxHops?: number;
  /** Milliseconds to wait for each probe (rounded up to whole seconds on macOS/Linux). Default: 1000. */
  probeTimeout?: number;
  /**
   * Stop after this many hops in a row that don't answer — past that point
   * the trail has usually gone cold for good. Set to 0 to always run to
   * `maxHops`. Default: 5.
   */
  giveUpAfter?: number;
  /** Milliseconds before the traceroute is cut short (the hops so far are still returned). 0 disables. Default: 60000. */
  timeout?: number;
  /** Abort the trace; the promise rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Look up each hop's hostname and location. Default: true. */
  geolocate?: boolean;
  /** Alternate hostip.info endpoint for hop lookups. */
  endpoint?: string | URL;
}

export interface TraceHop {
  /** TTL of the probe, starting at 1. */
  hop: number;
  /** Address that answered, or null if the probe timed out ("*"). */
  ip: string | null;
  /** Round-trip time of the first answer in milliseconds. */
  rtt: number | null;
  /** Reverse DNS name, when `geolocate` is on and one exists. */
  hostname: string | null;
  /** hostip.info's answer for this hop; null for private, silent, or failed lookups. */
  info: HostInfo | null;
  /** Location guessed from the hostname; see `hintFromHostname`. */
  hint: LocationHint | null;
}

export interface TraceResult {
  target: string;
  hops: TraceHop[];
  /** Whether the target itself answered. */
  reached: boolean;
  /**
   * Why the trace ended: the target answered, `maxHops` ran out, too many
   * silent hops in a row (`giveUpAfter`), or the overall `timeout` fired.
   */
  stopped: 'reached' | 'max-hops' | 'gave-up' | 'timeout';
  /** The furthest hop that answered — where the trail goes cold when the target isn't reached. */
  lastResponding: TraceHop | null;
}

const IPV4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;
const RTT = /<?(\d+(?:\.\d+)?)\s*ms\b/;

// Parses one hop line from BSD/Linux `traceroute -n` or Windows `tracert -d`:
//    3  108.254.2.1  11.268 ms
//    7  *
//    2    <1 ms    <1 ms    <1 ms  192.168.1.254
//    4     *        *        *     Request timed out.
function parseHopLine(line: string): Pick<TraceHop, 'hop' | 'ip' | 'rtt'> | null {
  const match = /^\s*(\d+)\s+(.*)$/.exec(line);
  if (!match) return null;
  const rest = match[2]!;
  const ip = IPV4.exec(rest)?.[1] ?? null;
  const rtt = RTT.exec(rest)?.[1];
  return {
    hop: Number(match[1]),
    ip: ip !== null && isIPv4(ip) ? ip : null,
    rtt: ip !== null && rtt !== undefined ? Number(rtt) : null,
  };
}

function tracerouteCommand(ip: string, maxHops: number, probeTimeout: number): [string, string[]] {
  if (process.platform === 'win32') {
    return ['tracert', ['-d', '-h', String(maxHops), '-w', String(probeTimeout), ip]];
  }
  const seconds = String(Math.max(1, Math.ceil(probeTimeout / 1000)));
  return ['traceroute', ['-n', '-q', '1', '-w', seconds, '-m', String(maxHops), ip]];
}

type RawHop = Pick<TraceHop, 'hop' | 'ip' | 'rtt'>;

function runTraceroute(
  ip: string,
  options: Required<Pick<TraceOptions, 'maxHops' | 'probeTimeout' | 'giveUpAfter' | 'timeout'>> & {
    signal: AbortSignal | undefined;
  },
): Promise<{ hops: RawHop[]; stopped: TraceResult['stopped'] }> {
  const { maxHops, probeTimeout, giveUpAfter, timeout, signal } = options;
  signal?.throwIfAborted();

  return new Promise((resolve, reject) => {
    const [command, args] = tracerouteCommand(ip, maxHops, probeTimeout);
    const child = childProcess.spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const hops: RawHop[] = [];
    let stopped: TraceResult['stopped'] | undefined;
    let silentRun = 0;
    let stderr = '';
    let settled = false;

    const stop = (reason: TraceResult['stopped']): void => {
      stopped ??= reason;
      child.kill();
    };
    const timer = timeout > 0 ? setTimeout(() => stop('timeout'), timeout) : undefined;
    const onAbort = (): void => {
      child.kill();
      finish(() => reject(signal!.reason));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    function finish(settle: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      settle();
    }

    createInterface({ input: child.stdout }).on('line', (line) => {
      const hop = parseHopLine(line);
      // Ignore headers, repeated hop numbers (extra probes), and anything
      // printed after we decided to stop.
      if (hop === null || stopped !== undefined || hops.some((h) => h.hop === hop.hop)) return;
      hops.push(hop);
      if (hop.ip === ip) return stop('reached');
      silentRun = hop.ip === null ? silentRun + 1 : 0;
      if (giveUpAfter > 0 && silentRun >= giveUpAfter) stop('gave-up');
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      const message =
        error.code === 'ENOENT'
          ? `\`${command}\` was not found; install it to use trace()`
          : `Could not run ${command}: ${error.message}`;
      finish(() => reject(new HostInfoError(message, { cause: error })));
    });
    child.on('close', (code) => {
      if (stopped === undefined && code !== 0 && hops.length === 0) {
        const detail = stderr.trim() || `exit code ${code}`;
        return finish(() => reject(new HostInfoError(`${command} failed: ${detail}`)));
      }
      finish(() => resolve({ hops, stopped: stopped ?? 'max-hops' }));
    });
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function geolocateHop(
  hop: RawHop,
  options: { signal: AbortSignal | undefined; endpoint: string | URL | undefined },
): Promise<TraceHop> {
  const located: TraceHop = { ...hop, hostname: null, info: null, hint: null };
  if (hop.ip === null || isPrivateIPv4(hop.ip)) return located;

  const { signal, endpoint } = options;
  // One failed lookup shouldn't sink the whole trace, so failures become null.
  const [hostnames, info] = await Promise.all([
    reverse(hop.ip, signal ? { signal } : {}).catch(() => []),
    lookup(hop.ip, { ...(signal && { signal }), ...(endpoint !== undefined && { endpoint }) }).catch(
      () => null,
    ),
  ]);
  signal?.throwIfAborted();
  located.hostname = hostnames[0] ?? null;
  located.info = info;
  located.hint = hostnames.map(hintFromHostname).find((hint) => hint !== null) ?? null;
  return located;
}

/**
 * Run the system traceroute (`traceroute` on macOS/Linux, `tracert` on
 * Windows) to an IPv4 address and report each hop, optionally with its
 * hostname and location. When the target never answers, `lastResponding` is
 * the furthest router that did — often the edge of the target's network.
 */
export async function trace(ip: string, options: TraceOptions = {}): Promise<TraceResult> {
  const {
    maxHops = 30,
    probeTimeout = 1000,
    giveUpAfter = 5,
    timeout = 60_000,
    signal,
    geolocate = true,
    endpoint,
  } = options;
  if (!isIPv4(ip)) {
    throw new TypeError(`Expected an IPv4 address, got ${JSON.stringify(ip)}`);
  }

  const raw = await runTraceroute(ip, { maxHops, probeTimeout, giveUpAfter, timeout, signal });
  const hops = geolocate
    ? await mapLimit(raw.hops, 4, (hop) => geolocateHop(hop, { signal, endpoint }))
    : raw.hops.map((hop) => ({ ...hop, hostname: null, info: null, hint: null }));

  const reached = raw.stopped === 'reached' || hops.some((hop) => hop.ip === ip);
  return {
    target: ip,
    hops,
    reached,
    stopped: reached ? 'reached' : raw.stopped,
    lastResponding: hops.findLast((hop) => hop.ip !== null) ?? null,
  };
}
