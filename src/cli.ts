#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { locate, type Location } from './locate.ts';
import { lookup, type HostInfo } from './lookup.ts';
import { serveMcp } from './mcp.ts';
import { toIP, toIPv4 } from './resolve.ts';
import { reverse } from './reverse.ts';
import { trace, type TraceHop, type TraceResult } from './trace.ts';
import { whois, type WhoisInfo } from './whois.ts';

const USAGE = `Usage:
  hostinfo [ip|host]          Locate an address (your own public IP if omitted)
  hostinfo trace <ip|host>    Traceroute, with each hop's hostname and location
  hostinfo reverse <ip|host>  Reverse DNS (PTR) names
  hostinfo whois <ip|host>    Network owner, range, and abuse contact (ARIN RDAP)
  hostinfo mcp                Run as an MCP server over stdio (for AI assistants)

Options:
  --trace     Let \`hostinfo <ip>\` fall back to a traceroute (slow)
  --json      Print raw JSON
  -h, --help  Show this help`;

function place(info: Pick<HostInfo, 'city' | 'country' | 'countryCode'> | null): string | null {
  if (!info) return null;
  const parts = [info.city, info.country ?? info.countryCode].filter((p) => p !== null);
  return parts.length > 0 ? parts.join(', ') : null;
}

function formatLocation(result: Location): string {
  const lines = [result.ip ?? '(unknown ip)'];
  if (result.hostname) lines.push(`  hostname  ${result.hostname}`);
  lines.push(`  location  ${place(result) ?? 'unknown'}`);
  if (result.latitude !== null && result.longitude !== null) {
    lines.push(`  coords    ${result.latitude}, ${result.longitude}`);
  }
  if (result.source) {
    const via = result.via ? ` (hop ${result.via.hop}, ${result.via.ip})` : '';
    lines.push(`  source    ${result.source}${via}`);
  }
  return lines.join('\n');
}

function formatWhois(info: WhoisInfo): string {
  const range =
    info.startAddress && info.endAddress ? `${info.startAddress} - ${info.endAddress}` : null;
  const rows: [string, string | null][] = [
    ['org', info.organization],
    ['network', [info.name, info.handle && `(${info.handle})`].filter(Boolean).join(' ') || null],
    ['range', [range, info.cidrs.join(', ')].filter(Boolean).join('  ') || null],
    ['type', info.type],
    ['country', info.country],
    ['abuse', info.abuseEmail],
    ['registered', info.registered],
    ['updated', info.updated],
    ['registry', info.registry],
  ];
  const lines = [info.ip];
  for (const [label, value] of rows) if (value) lines.push(`  ${label.padEnd(10)}  ${value}`);
  return lines.join('\n');
}

function formatHop(hop: TraceHop): string {
  const n = String(hop.hop).padStart(2);
  if (hop.ip === null) return `${n}  *`;
  const rtt = hop.rtt === null ? '' : `${hop.rtt} ms`;
  const where = place(hop.info) ?? (hop.hint ? `${hop.hint.city}? (from "${hop.hint.code}")` : '');
  return [`${n}  ${hop.ip.padEnd(15)}  ${rtt.padStart(10)}`, hop.hostname, where]
    .filter(Boolean)
    .join('  ');
}

function formatTrace(result: TraceResult): string {
  const lines = [`traceroute to ${result.target}`, ...result.hops.map(formatHop)];
  if (!result.reached) {
    const last = result.lastResponding;
    lines.push(`did not reach ${result.target} (${result.stopped})`);
    if (last) lines.push(`last responding hop: ${last.hop} ${last.ip}`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: 'boolean' },
      trace: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return console.log(USAGE);

  const [first, second] = positionals;
  if (first === 'mcp') return serveMcp();

  const command =
    first === 'trace' || first === 'reverse' || first === 'whois' ? first : 'locate';
  const target = command === 'locate' ? first : second;
  if (command !== 'locate' && target === undefined) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  const { signal } = controller;
  const print = (value: unknown, format: () => string): void =>
    console.log(values.json ? JSON.stringify(value, null, 2) : format());

  if (command === 'trace') {
    const result = await trace(await toIPv4(target!), { signal });
    return print(result, () => formatTrace(result));
  }
  if (command === 'whois') {
    const info = await whois(await toIP(target!), { signal });
    return print(info, () => formatWhois(info));
  }
  if (command === 'reverse') {
    const names = await reverse(await toIP(target!), { signal });
    return print(names, () => (names.length > 0 ? names.join('\n') : '(no PTR records)'));
  }

  // Without a target, ask hostip.info who we are first.
  const ip = target === undefined ? (await lookup({ signal })).ip : await toIPv4(target);
  if (ip === null) throw new Error('hostip.info did not report your public IP');
  const result = await locate(ip, { signal, ...(values.trace && { trace: { signal } }) });
  print(result, () => formatLocation(result));
}

main().catch((error: unknown) => {
  console.error(`hostinfo: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
