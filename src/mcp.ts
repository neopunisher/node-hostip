// A zero-dependency Model Context Protocol server over stdio, so AI assistants
// can call locate/trace/reverse/whois as tools. Messages are newline-delimited
// JSON-RPC 2.0; see https://modelcontextprotocol.io/specification.
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';

import { hintFromHostname } from './hints.ts';
import { locate } from './locate.ts';
import { lookup } from './lookup.ts';
import { toIP, toIPv4 } from './resolve.ts';
import { reverse } from './reverse.ts';
import { trace } from './trace.ts';
import { whois } from './whois.ts';

// Newest first. We only use features common to all of them.
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

type Args = Record<string, unknown>;

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, object>; required?: string[] };
  run: (args: Args, signal: AbortSignal) => Promise<unknown>;
}

const TARGET = {
  type: 'string',
  description: 'IPv4 address or hostname (hostnames are resolved to their first IPv4 address).',
};

function str(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`"${key}" must be a non-empty string`);
  }
  return value.trim();
}

function required(args: Args, key: string): string {
  const value = str(args, key);
  if (value === undefined) throw new TypeError(`"${key}" is required`);
  return value;
}

const TOOLS: Tool[] = [
  {
    name: 'locate',
    title: 'Geolocate an IP address',
    description:
      'Find the city, country, and coordinates of an IPv4 address or hostname. Asks hostip.info first, ' +
      'then falls back to location codes in the reverse DNS name, and optionally to a traceroute. ' +
      'The `source` field says where the answer came from ("hostip" is most reliable, "traceroute" least). ' +
      'Omit `target` to locate the machine running this server.',
    inputSchema: {
      type: 'object',
      properties: {
        target: TARGET,
        trace: {
          type: 'boolean',
          description:
            'If nothing else finds a city, traceroute to the target and use the nearest hop with a location. Slow (up to a minute).',
        },
      },
    },
    async run(args, signal) {
      const target = str(args, 'target');
      const ip = target === undefined ? (await lookup({ signal })).ip : await toIPv4(target);
      if (ip === null) throw new Error('hostip.info did not report a public IP for this machine');
      return locate(ip, { signal, ...(args['trace'] === true && { trace: { signal } }) });
    },
  },
  {
    name: 'traceroute',
    title: 'Traceroute',
    description:
      'Run a traceroute to an IPv4 address or hostname and report every hop with its reverse DNS name and ' +
      'location. Useful for seeing where traffic goes or where it stops. Takes seconds to a minute.',
    inputSchema: {
      type: 'object',
      properties: {
        target: TARGET,
        maxHops: { type: 'integer', minimum: 1, maximum: 64, description: 'Highest TTL to probe. Default 30.' },
      },
      required: ['target'],
    },
    async run(args, signal) {
      const ip = await toIPv4(required(args, 'target'));
      const maxHops = args['maxHops'];
      if (maxHops !== undefined && (!Number.isInteger(maxHops) || (maxHops as number) < 1)) {
        throw new TypeError('"maxHops" must be a positive integer');
      }
      return trace(ip, { signal, ...(maxHops !== undefined && { maxHops: maxHops as number }) });
    },
  },
  {
    name: 'reverse_dns',
    title: 'Reverse DNS',
    description: 'Look up the hostnames (PTR records) for an IPv4 or IPv6 address. Returns an empty list if there are none.',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string', description: 'IPv4/IPv6 address or hostname.' } },
      required: ['target'],
    },
    async run(args, signal) {
      return reverse(await toIP(required(args, 'target')), { signal });
    },
  },
  {
    name: 'whois',
    title: 'IP WHOIS (RDAP)',
    description:
      'Who owns the network an IP address belongs to: organization, address range and CIDRs, allocation type, ' +
      'abuse contact, and registration dates, from the regional internet registry via RDAP.',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string', description: 'IPv4/IPv6 address or hostname.' } },
      required: ['target'],
    },
    async run(args, signal) {
      return whois(await toIP(required(args, 'target')), { signal });
    },
  },
  {
    name: 'hostname_hint',
    title: 'Guess location from a hostname',
    description:
      'Guess a location from the airport, CLLI, or city code that network operators embed in router and ' +
      'server hostnames (e.g. "ae-5.r21.lsanca07.us.bb.gin.ntt.net" is Los Angeles). Offline; returns null if no code is recognized.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'A DNS hostname.' } },
      required: ['hostname'],
    },
    async run(args) {
      return hintFromHostname(required(args, 'hostname'));
    },
  },
];

type Id = string | number;

interface Message {
  jsonrpc?: unknown;
  id?: Id | null;
  method?: unknown;
  params?: Args;
}

export type McpResponse =
  | { jsonrpc: '2.0'; id: Id | null; result: unknown }
  | { jsonrpc: '2.0'; id: Id | null; error: { code: number; message: string } };

function errorResponse(id: Id | null, code: number, message: string): McpResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export interface McpSession {
  /** Handle one parsed JSON-RPC message. Resolves to the response, or null for notifications. */
  handle(message: unknown): Promise<McpResponse | null>;
  /** Abort every in-flight tool call. */
  close(): void;
}

export function createMcpSession(): McpSession {
  const inFlight = new Map<Id, AbortController>();

  async function callTool(id: Id, params: Args): Promise<unknown> {
    const tool = TOOLS.find((t) => t.name === params['name']);
    if (!tool) throw Object.assign(new Error(`Unknown tool: ${String(params['name'])}`), { code: -32602 });
    const args = (params['arguments'] ?? {}) as Args;
    const controller = new AbortController();
    inFlight.set(id, controller);
    try {
      const result = await tool.run(args, controller.signal);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (error) {
      // Tool failures go back to the model as results so it can react to them.
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: message }], isError: true };
    } finally {
      inFlight.delete(id);
    }
  }

  async function handle(raw: unknown): Promise<McpResponse | null> {
    const message = (raw ?? {}) as Message;
    const isRequest = message.id !== undefined && message.id !== null;
    const id = isRequest ? (message.id as Id) : null;
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return errorResponse(id, -32600, 'Invalid Request');
    }
    const params = message.params ?? {};

    if (!isRequest) {
      if (message.method === 'notifications/cancelled') {
        inFlight.get(params['requestId'] as Id)?.abort(new Error('Cancelled by client'));
      }
      return null;
    }

    try {
      switch (message.method) {
        case 'initialize': {
          const requested = params['protocolVersion'];
          const protocolVersion =
            typeof requested === 'string' && PROTOCOL_VERSIONS.includes(requested)
              ? requested
              : PROTOCOL_VERSIONS[0];
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: 'hostinfo', title: 'hostinfo', version },
              instructions:
                'IP geolocation and network lookups. Use `locate` for "where is this IP/host", `whois` for ' +
                '"who owns it", `reverse_dns` for its hostnames, and `traceroute` for the network path. ' +
                'Locations are approximate; check `source` on locate results.',
            },
          };
        }
        case 'ping':
          return { jsonrpc: '2.0', id, result: {} };
        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: TOOLS.map(({ run: _run, ...tool }) => ({
                ...tool,
                annotations: { readOnlyHint: true, openWorldHint: tool.name !== 'hostname_hint' },
              })),
            },
          };
        case 'tools/call':
          return { jsonrpc: '2.0', id, result: await callTool(id!, params) };
        default:
          return errorResponse(id, -32601, `Method not found: ${message.method}`);
      }
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      return errorResponse(
        id,
        typeof code === 'number' ? code : -32603,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return {
    handle,
    close() {
      for (const controller of inFlight.values()) controller.abort(new Error('Server closed'));
    },
  };
}

export interface ServeMcpOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/** Serve MCP over newline-delimited JSON on stdin/stdout until the input ends. */
export async function serveMcp(options: ServeMcpOptions = {}): Promise<void> {
  const { input = process.stdin, output = process.stdout } = options;
  const session = createMcpSession();
  const pending = new Set<Promise<void>>();
  const send = (response: McpResponse | null): void => {
    if (response) output.write(`${JSON.stringify(response)}\n`);
  };

  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (line.trim() === '') continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      send(errorResponse(null, -32700, 'Parse error'));
      continue;
    }
    // Handle requests concurrently so a slow traceroute doesn't block pings or cancellation.
    const task = session.handle(message).then(send);
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }
  session.close();
  await Promise.allSettled(pending);
}
