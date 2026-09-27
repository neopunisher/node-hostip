import { hintFromHostname, type LocationHint } from './hints.ts';
import { lookup, type HostInfo, type LookupOptions } from './lookup.ts';
import { reverse } from './reverse.ts';
import { trace, type TraceHop, type TraceOptions } from './trace.ts';

export interface LocateOptions extends LookupOptions {
  /**
   * When neither hostip.info nor the target's hostname gives a city, traceroute
   * to the target and borrow the location of the closest hop that has one.
   * Pass `true` or trace options. Slow (seconds) — default: false.
   */
  trace?: boolean | TraceOptions;
}

export interface Location extends HostInfo {
  /** The target's reverse DNS name, if it has one. */
  hostname: string | null;
  /**
   * Where `city` and the coordinates came from: hostip.info, a location code
   * in the target's hostname, or a traceroute hop. null when no city was found.
   */
  source: 'hostip' | 'hostname' | 'traceroute' | null;
  /** For `source: 'traceroute'`, the hop whose location was used. */
  via: TraceHop | null;
}

function fromHint(info: HostInfo, hint: LocationHint): Pick<Location, keyof HostInfo> {
  return {
    ip: info.ip,
    city: hint.city,
    // hostip.info's country name only applies if it agrees with the hint.
    country: info.countryCode === hint.countryCode ? info.country : null,
    countryCode: hint.countryCode,
    latitude: hint.latitude,
    longitude: hint.longitude,
  };
}

/**
 * Best-effort geolocation for an IPv4 address. Asks hostip.info first, then
 * falls back to location codes in the target's reverse DNS name (e.g.
 * "…lax01.example.net"), and optionally to a traceroute. Check `source` to see
 * how much to trust the answer.
 */
export async function locate(ip: string, options: LocateOptions = {}): Promise<Location> {
  const { trace: traceOption = false, ...lookupOptions } = options;
  const { signal } = lookupOptions;

  const [info, hostnames] = await Promise.all([
    lookup(ip, lookupOptions),
    // lookup() validates the address; a failed reverse lookup just means no hint.
    reverse(ip, signal ? { signal } : {}).catch(() => [] as string[]),
  ]);
  const hostname = hostnames[0] ?? null;

  if (info.city !== null) {
    return { ...info, hostname, source: 'hostip', via: null };
  }

  const hint = hostnames.map(hintFromHostname).find((h) => h !== null);
  if (hint) {
    return { ...fromHint(info, hint), hostname, source: 'hostname', via: null };
  }

  if (traceOption !== false) {
    const traceOptions: TraceOptions = {
      ...(signal && { signal }),
      ...(lookupOptions.endpoint !== undefined && { endpoint: lookupOptions.endpoint }),
      ...(traceOption === true ? {} : traceOption),
      geolocate: true,
    };
    const { hops } = await trace(ip, traceOptions);
    // Walk back from the target: the nearest located router is the best proxy.
    for (const hop of hops.toReversed()) {
      if (hop.ip === null || hop.ip === ip) continue;
      if (hop.info?.city != null) {
        return { ...hop.info, ip: info.ip, hostname, source: 'traceroute', via: hop };
      }
      if (hop.hint) {
        return { ...fromHint(info, hop.hint), hostname, source: 'traceroute', via: hop };
      }
    }
  }

  return { ...info, hostname, source: null, via: null };
}
