# Agent notes

Contributor guide for AI coding agents. User-facing API docs live in [README.md](README.md) and, condensed, in [llms.txt](llms.txt) (shipped in the npm package) — update both when the public API, CLI, or MCP tools change.

## Layout

- `src/` — TypeScript sources, one module per feature: `lookup.ts` (hostip.info), `locate.ts` (fallback chain), `trace.ts`, `reverse.ts`, `whois.ts` (RDAP), `hints.ts` (hostname → location table), `private.ts`, `resolve.ts` (hostname → IP), `cli.ts`, `mcp.ts` (stdio MCP server). `index.ts` is the public surface.
- `test/` — `node:test` suites that import `../src/*.ts` directly and mock `fetch`/`child_process`. `package.test.ts` checks the built `dist/` through the package exports.

## Rules

- **Zero runtime dependencies.** Use Node built-ins only; that includes the MCP server, which implements JSON-RPC by hand rather than using `@modelcontextprotocol/sdk`.
- Node >= 22.12, ESM only. Relative imports use the `.ts` extension (rewritten at build).
- `tsconfig.json` is strict with `isolatedDeclarations` and `exactOptionalPropertyTypes`: exported functions need explicit return types, and optional properties can't be passed `undefined` (spread conditionally instead: `...(x !== undefined && { x })`).
- Unknown values are `null`. Network failures throw `HostInfoError`; bad input throws `TypeError`.
- Every network call takes `signal` and a `timeout`.
- In `mcp.ts`, stdout is the protocol channel — never `console.log` there.

## Commands

```sh
npm run typecheck   # build + tsc over src and tests
npm test            # build + unit tests (no network)
npm run test:live   # also hits real APIs
```

Try the MCP server by piping JSON-RPC lines into `node dist/cli.js mcp`.
