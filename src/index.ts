import { hintFromHostname } from './hints.ts';
import { locate } from './locate.ts';
import { HostInfoError, lookup } from './lookup.ts';
import { reverse } from './reverse.ts';
import { isPrivateIPv4 } from './private.ts';
import { trace } from './trace.ts';
import { whois } from './whois.ts';

export { hintFromHostname, type LocationHint } from './hints.ts';
export { locate, type LocateOptions, type Location } from './locate.ts';
export {
  HostInfoError,
  lookup,
  type HostInfo,
  type LookupCallback,
  type LookupOptions,
} from './lookup.ts';
export { reverse, type ReverseOptions } from './reverse.ts';
export { isPrivateIPv4 } from './private.ts';
export { trace, type TraceHop, type TraceOptions, type TraceResult } from './trace.ts';
export { whois, type WhoisContact, type WhoisInfo, type WhoisOptions } from './whois.ts';

const hostinfo: {
  lookup: typeof lookup;
  locate: typeof locate;
  reverse: typeof reverse;
  trace: typeof trace;
  whois: typeof whois;
  hintFromHostname: typeof hintFromHostname;
  isPrivateIPv4: typeof isPrivateIPv4;
  HostInfoError: typeof HostInfoError;
} = {
  lookup,
  locate,
  reverse,
  trace,
  whois,
  hintFromHostname,
  isPrivateIPv4,
  HostInfoError,
};
export default hostinfo;
