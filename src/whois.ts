import { isIP } from 'node:net';

import { HostInfoError } from './lookup.ts';

// ARIN's RDAP service answers for its own space and redirects everything else
// to the registry that holds it (RIPE, APNIC, LACNIC, AFRINIC), which fetch
// follows for us.
const DEFAULT_ENDPOINT = 'https://rdap.arin.net/registry/ip/';
const DEFAULT_TIMEOUT = 10_000;

export interface WhoisOptions {
  /** Milliseconds before the request is aborted. Set to 0 to disable. Default: 10000. */
  timeout?: number;
  /** Abort the request yourself. Combined with `timeout`; whichever fires first wins. */
  signal?: AbortSignal;
  /** Alternate RDAP base URL; the IP is appended. Default: "https://rdap.arin.net/registry/ip/". */
  endpoint?: string | URL;
}

export interface WhoisContact {
  /** Registry handle, e.g. "ABUSE5250-ARIN". */
  handle: string | null;
  /** RDAP roles such as "registrant", "abuse", "technical", "administrative". */
  roles: string[];
  /** vCard kind: "org", "group", "individual", ... */
  kind: string | null;
  name: string | null;
  org: string | null;
  email: string | null;
  phone: string | null;
  /** Postal address as a single multi-line string. */
  address: string | null;
}

export interface WhoisInfo {
  /** The address that was looked up. */
  ip: string;
  /** Network handle, e.g. "NET-8-8-8-0-2". */
  handle: string | null;
  /** Network name, e.g. "GOGL". */
  name: string | null;
  /** Allocation type, e.g. "DIRECT ALLOCATION". */
  type: string | null;
  parentHandle: string | null;
  /** Two-letter country code, when the registry records one. */
  country: string | null;
  startAddress: string | null;
  endAddress: string | null;
  /** The network in CIDR notation, e.g. ["8.8.8.0/24"]. */
  cidrs: string[];
  status: string[];
  /** Organization the network is registered to. */
  organization: string | null;
  /** Where to report abuse from this network. */
  abuseEmail: string | null;
  /** ISO 8601 timestamps from the registry. */
  registered: string | null;
  updated: string | null;
  /** The registry's whois server, e.g. "whois.arin.net" or "whois.ripe.net". */
  registry: string | null;
  contacts: WhoisContact[];
}

// Just the parts of an RDAP (RFC 9083) IP network response we read.
interface RdapEntity {
  handle?: string;
  roles?: string[];
  vcardArray?: [string, [string, Record<string, unknown>, string, unknown][]];
  entities?: RdapEntity[];
}

interface RdapNetwork {
  objectClassName?: string;
  handle?: string;
  name?: string;
  type?: string;
  parentHandle?: string;
  country?: string;
  startAddress?: string;
  endAddress?: string;
  status?: string[];
  port43?: string;
  cidr0_cidrs?: { v4prefix?: string; v6prefix?: string; length?: number }[];
  events?: { eventAction?: string; eventDate?: string }[];
  entities?: RdapEntity[];
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function vcardField(entity: RdapEntity, name: string): string | null {
  const property = entity.vcardArray?.[1]?.find((p) => p[0] === name);
  if (!property) return null;
  // Addresses carry the formatted text in a "label" parameter; the structured
  // value is usually blank.
  if (name === 'adr') return text(property[1]['label']);
  return text(property[3]);
}

function toContact(entity: RdapEntity): WhoisContact {
  return {
    handle: text(entity.handle),
    roles: [...(entity.roles ?? [])],
    kind: vcardField(entity, 'kind'),
    name: vcardField(entity, 'fn'),
    org: vcardField(entity, 'org'),
    email: vcardField(entity, 'email'),
    phone: vcardField(entity, 'tel'),
    address: vcardField(entity, 'adr'),
  };
}

// Contacts nest (ARIN hangs abuse/tech under the registrant) and repeat once
// per role (RIPE), so flatten them and merge roles by handle.
function collectContacts(entities: RdapEntity[] = []): WhoisContact[] {
  const contacts: WhoisContact[] = [];
  const byHandle = new Map<string, WhoisContact>();
  const visit = (list: RdapEntity[]): void => {
    for (const entity of list) {
      const contact = toContact(entity);
      const existing = contact.handle === null ? undefined : byHandle.get(contact.handle);
      if (existing) {
        for (const role of contact.roles) {
          if (!existing.roles.includes(role)) existing.roles.push(role);
        }
        for (const key of ['kind', 'name', 'org', 'email', 'phone', 'address'] as const) {
          existing[key] ??= contact[key];
        }
      } else {
        contacts.push(contact);
        if (contact.handle !== null) byHandle.set(contact.handle, contact);
      }
      visit(entity.entities ?? []);
    }
  };
  visit(entities);
  return contacts;
}

function eventDate(network: RdapNetwork, action: string): string | null {
  return text(network.events?.find((e) => e.eventAction === action)?.eventDate);
}

function parseRdap(ip: string, network: RdapNetwork): WhoisInfo {
  if (network.objectClassName !== 'ip network') {
    throw new HostInfoError('Unexpected RDAP response: not an IP network');
  }
  const contacts = collectContacts(network.entities);
  const withRole = (role: string) => contacts.filter((c) => c.roles.includes(role));
  // RIPE also lists maintainer objects as registrants; prefer the organization.
  const registrants = withRole('registrant');
  const registrant = registrants.find((c) => c.kind === 'org') ?? registrants[0];
  return {
    ip,
    handle: text(network.handle),
    name: text(network.name),
    type: text(network.type),
    parentHandle: text(network.parentHandle),
    country: text(network.country),
    startAddress: text(network.startAddress),
    endAddress: text(network.endAddress),
    cidrs: (network.cidr0_cidrs ?? []).flatMap((c) => {
      const prefix = c.v4prefix ?? c.v6prefix;
      return prefix && c.length !== undefined ? [`${prefix}/${c.length}`] : [];
    }),
    status: [...(network.status ?? [])],
    organization: registrant?.name ?? registrant?.org ?? null,
    abuseEmail: withRole('abuse').find((c) => c.email !== null)?.email ?? null,
    registered: eventDate(network, 'registration'),
    updated: eventDate(network, 'last changed'),
    registry: text(network.port43),
    contacts,
  };
}

/**
 * Registration data for the network an IPv4 or IPv6 address belongs to: who
 * owns it, its range, and its abuse contact. Queries ARIN's RDAP service,
 * which hands off to the right regional registry for non-ARIN space.
 */
export async function whois(ip: string, options: WhoisOptions = {}): Promise<WhoisInfo> {
  const { timeout = DEFAULT_TIMEOUT, signal, endpoint = DEFAULT_ENDPOINT } = options;
  if (!isIP(ip)) {
    throw new TypeError(`Expected an IP address, got ${JSON.stringify(ip)}`);
  }

  const base = new URL(endpoint);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const url = new URL(encodeURIComponent(ip), base);

  const signals = [signal, timeout > 0 ? AbortSignal.timeout(timeout) : undefined].filter(
    (s): s is AbortSignal => s !== undefined,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/rdap+json' },
      signal: signals.length > 0 ? AbortSignal.any(signals) : null,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new HostInfoError(`RDAP request for ${ip} failed: ${message}`, { cause });
  }
  if (!response.ok) {
    throw new HostInfoError(`RDAP lookup for ${ip} responded with HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new HostInfoError('Unexpected RDAP response: not JSON', { cause });
  }
  return parseRdap(ip, (body ?? {}) as RdapNetwork);
}
