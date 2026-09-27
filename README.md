# hostinfo

[![CI](https://github.com/neopunisher/node-hostip/actions/workflows/ci.yml/badge.svg)](https://github.com/neopunisher/node-hostip/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hostinfo)](https://www.npmjs.com/package/hostinfo)
[![npm downloads](https://img.shields.io/npm/dm/hostinfo)](https://www.npmjs.com/package/hostinfo)

Geocode IP addresses to city, country, and coordinates using the free, community-built [hostip.info](https://www.hostip.info/) API. When hostip.info has no answer, it can fall back to reverse DNS and traceroute. Zero dependencies.

```js
import { lookup } from 'hostinfo';

const info = await lookup('8.8.8.8');
// {
//   ip: '8.8.8.8',
//   city: 'Mountain View, CA',
//   country: 'UNITED STATES',
//   countryCode: 'US',
//   latitude: 37.402,
//   longitude: -122.078
// }
```

## Install

```sh
npm install hostinfo
```

Requires Node.js 22.12 or newer. Written in TypeScript and published as ESM with bundled types; CommonJS callers can still `require('hostinfo')` thanks to Node's built-in `require(esm)` support.

## API

### `lookup(ip?, options?) → Promise<HostInfo>`

Looks up an IPv4 address (anything else rejects with a `TypeError`, since hostip.info has no IPv6 data). Omit `ip` to geocode the caller's own public address:

```js
const whereAmI = await lookup();
```

Fields that hostip.info does not know are `null`, including `countryCode` (the API's `"XX"` placeholder becomes `null`). Coordinates are only present for IPs mapped to a city. Private addresses (see [`isPrivateIPv4`](#isprivateipv4ip--boolean)) resolve to all-`null` fields immediately, without a request.

**Options**

| option | default | |
| --- | --- | --- |
| `timeout` | `10000` | Milliseconds before the request aborts. `0` disables. |
| `signal` | – | Your own `AbortSignal`; combined with `timeout`, whichever fires first aborts. |
| `endpoint` | `https://api.hostip.info/` | Alternate API base URL. |

Failures (network, HTTP status, unparseable response) reject with a `HostInfoError`; network errors keep the underlying error on `.cause`.

### `locate(ip, options?) → Promise<Location>`

Best-effort geolocation when hostip.info comes up empty. It tries, in order:

1. **hostip.info** — same as `lookup()`.
2. **Reverse DNS** — network operators usually put a location code in router and server hostnames (`108-254-2-1.lightspeed.hstntx.sbcglobal.net` → Houston, `ae-5.r21.lsanca07.us.bb.gin.ntt.net` → Los Angeles). `locate` recognizes CLLI codes, airport codes, and city names for about 120 major network hubs.
3. **Traceroute** (opt-in with `trace: true`) — runs a traceroute to the target and borrows the location of the closest hop that has one.

```js
import { locate } from 'hostinfo';

const where = await locate('32.130.20.13', { trace: true });
// {
//   ip: '32.130.20.13', city: 'Richardson, TX', country: 'UNITED STATES', countryCode: 'US',
//   latitude: null, longitude: null, hostname: null,
//   source: 'traceroute',
//   via: { hop: 4, ip: '71.149.39.230', rtt: 13.2, hostname: null, info: { … }, hint: null }
// }
```

The result has all the `HostInfo` fields plus:

| field | |
| --- | --- |
| `hostname` | The target's reverse DNS name, or `null`. |
| `source` | Where `city`/coordinates came from: `'hostip'`, `'hostname'`, `'traceroute'`, or `null` if nothing was found. |
| `via` | For `'traceroute'`, the hop whose location was used. |

Takes the `lookup()` options plus `trace` (`true` or [trace options](#traceip-options--promisetraceresult)). Treat `'hostname'` and especially `'traceroute'` answers as rough: the hop nearest the target is often in the same metro area, but it can also be a regional hub hundreds of miles away.

### `trace(ip, options?) → Promise<TraceResult>`

Runs the system `traceroute` (macOS/Linux) or `tracert` (Windows) to an IPv4 address. It reports every hop, and where the trail goes cold if the target never answers:

```js
import { trace } from 'hostinfo';

const { hops, reached, stopped, lastResponding } = await trace('198.51.100.7');
if (!reached) console.log(`Dropped after hop ${lastResponding?.hop} (${lastResponding?.hostname ?? lastResponding?.ip})`);
```

Each hop is `{ hop, ip, rtt, hostname, info, hint }`. `ip` is `null` for a probe that timed out (`*`). `info` is hostip.info's answer, and `hint` is the location guessed from `hostname`. [Private hops](#isprivateipv4ip--boolean) are never sent to hostip.info. `stopped` is `'reached'`, `'max-hops'`, `'gave-up'`, or `'timeout'`.

| option | default | |
| --- | --- | --- |
| `maxHops` | `30` | Highest TTL to probe. |
| `probeTimeout` | `1000` | Milliseconds to wait per probe. macOS/Linux round this up to whole seconds. |
| `giveUpAfter` | `5` | Stop after this many silent hops in a row. `0` runs all the way to `maxHops`. |
| `timeout` | `60000` | Cut the trace short after this many milliseconds and return the hops so far. `0` disables. |
| `signal` | – | Abort the trace. The promise rejects with the signal's reason. |
| `geolocate` | `true` | Look up each hop's hostname and location. |
| `endpoint` | – | Alternate hostip.info endpoint. |

Rejects with a `HostInfoError` if traceroute isn't installed (e.g. minimal Linux containers: `apt install traceroute`).

### `reverse(ip, options?) → Promise<string[]>`

Reverse DNS (PTR) lookup for an IPv4 or IPv6 address. Returns `[]` when there's no record. Options: `timeout` (default `5000`) and `signal`.

### `whois(ip, options?) → Promise<WhoisInfo>`

Registration data for the network an IPv4 or IPv6 address belongs to, from [ARIN's RDAP service](https://www.arin.net/resources/registry/whois/rdap/). ARIN redirects addresses held by other registries (RIPE, APNIC, LACNIC, AFRINIC) to the right one automatically.

```js
const info = await whois('8.8.8.8');
// {
//   organization: 'Google LLC', name: 'GOGL', handle: 'NET-8-8-8-0-2',
//   startAddress: '8.8.8.0', endAddress: '8.8.8.255', cidrs: ['8.8.8.0/24'],
//   type: 'DIRECT ALLOCATION', abuseEmail: 'network-abuse@google.com',
//   registry: 'whois.arin.net', contacts: [ … ], …
// }
```

`contacts` lists every entity in the record with its `roles`, `name`, `org`, `email`, `phone`, and `address`. Options: `timeout` (default `10000`), `signal`, and `endpoint` (an alternate RDAP base URL). Rejects with a `HostInfoError` on network or HTTP errors.

### `hintFromHostname(hostname) → LocationHint | null`

The hostname heuristic on its own: `{ code, city, countryCode, latitude, longitude }` or `null`.

```js
hintFromHostname('be2345.ccr41.fra03.atlas.cogentco.com'); // { code: 'fra', city: 'Frankfurt', … }
```

### `isPrivateIPv4(ip) → boolean`

True for IPv4 addresses that aren't publicly routable: loopback, link-local, RFC 1918, carrier-grade NAT (`100.64.0.0/10`), IETF protocol assignments (`192.0.0.0/24`), benchmarking (`198.18.0.0/15`), multicast (`224.0.0.0/4`), and reserved space (`240.0.0.0/4`). The TEST-NET documentation ranges are deliberately not included. `false` for anything that isn't an IPv4 address.

### Command line

```sh
npx hostinfo 8.8.8.8          # locate an address (or omit it for your own public IP)
npx hostinfo 8.8.8.8 --trace  # fall back to a traceroute if needed
npx hostinfo trace example.com
npx hostinfo reverse 1.1.1.1
npx hostinfo whois 8.8.8.8     # owner, range, and abuse contact from ARIN
npx hostinfo mcp               # run as an MCP server (see below)
```

Hostnames are resolved to an IPv4 address first. Add `--json` for machine-readable output.

```
$ npx hostinfo trace 1.1.1.1
traceroute to 1.1.1.1
 1  192.168.86.1       9.518 ms
 2  192.168.1.254     12.512 ms
 3  108.254.2.1       13.706 ms  108-254-2-1.lightspeed.hstntx.sbcglobal.net  Houston, TX? (from "hstntx")
 4  71.149.39.230      12.02 ms  Richardson, TX, UNITED STATES
 ...
11  1.1.1.1           20.103 ms  one.one.one.one  Buffalo, NY, UNITED STATES
```

A `?` marks a location guessed from the hostname rather than reported by hostip.info.

### MCP server (for AI assistants)

`hostinfo mcp` runs a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio, so Claude, Cursor, VS Code, and other MCP clients can geolocate, trace, and WHOIS addresses for you. Add it to your client's config:

```json
{
  "mcpServers": {
    "hostinfo": { "command": "npx", "args": ["-y", "hostinfo", "mcp"] }
  }
}
```

With Claude Code: `claude mcp add hostinfo -- npx -y hostinfo mcp`.

| tool | arguments | |
| --- | --- | --- |
| `locate` | `target?`, `trace?` | [`locate()`](#locateip-options--promiselocation); omit `target` for the server's own public IP |
| `traceroute` | `target`, `maxHops?` | [`trace()`](#traceip-options--promisetraceresult) |
| `reverse_dns` | `target` | [`reverse()`](#reverseip-options--promisestring) |
| `whois` | `target` | [`whois()`](#whoisip-options--promisewhoisinfo) |
| `hostname_hint` | `hostname` | [`hintFromHostname()`](#hintfromhostnamehostname--locationhint--null) |

`target` can be an IP address or a hostname. All tools are read-only, and results are the same JSON the library returns. Like the rest of the package, the server has no dependencies. (Traceroute runs on the machine hosting the server, so it measures that machine's path.)

### For AI coding tools

[`llms.txt`](llms.txt) is a condensed API reference for LLMs, and it ships in the package at `node_modules/hostinfo/llms.txt`. Contributors' agents should read [`AGENTS.md`](AGENTS.md).

### Callback style

The original 2011 signature still works if you pass a function last:

```js
const { lookup } = require('hostinfo');

lookup('8.8.8.8', (err, info) => {
  if (err) throw err;
  console.log(info.city);
});
```

> **Upgrading from 1.x:** the package is now ESM-only (CommonJS `require` still works on Node 22.12+), Node 18/20 are no longer supported, non-IPv4 input rejects with a `TypeError` instead of silently returning "(Private Address)", an unknown `countryCode` is `null` instead of `'XX'`, private addresses no longer hit the network, and `signal` no longer disables `timeout`.
>
> **Upgrading from 0.0.2:** the result is now the flat object shown above rather than the raw `xml2js` parse of the API response, and the `request`/`xml2js` dependencies are gone.

## Accuracy

hostip.info is a community-maintained database. It's free and requires no API key, but coverage and accuracy are modest compared to commercial GeoIP databases — treat results as approximate.

## Development

```sh
npm install
npm run typecheck   # tsc over src and tests
npm test            # builds dist/, then runs unit tests (mocked fetch) and package-export checks
npm run test:live   # also hits the real API
```

The published package runs on Node 22.12+, but the tests run the TypeScript sources directly, which needs type stripping (on by default from Node 22.18).

## Releasing

Publishing is automated with GitHub Actions via [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) — no npm tokens stored in the repo:

1. Bump `version` in `package.json`, commit, and push (CI must be green).
2. Create a GitHub release with a matching `vX.Y.Z` tag.
3. The [publish workflow](.github/workflows/publish.yml) runs the tests and stages the version on npm (`npm stage publish`) with provenance.
4. Approve the staged version with 2FA — on npmjs.com under **Staged Packages**, or with `npm stage approve <stage-id>` (the id is in the workflow log).

One-time setup: on npmjs.com → package **Settings** → **Trusted Publisher**, select GitHub Actions with repository `neopunisher/node-hostip` and workflow `publish.yml`, leaving direct `npm publish` disallowed (staging-only).

## License

MIT © Carter Cole
