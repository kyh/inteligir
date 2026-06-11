# `@repo/dispatch` — mobile↔desktop wire protocol

The shared contract that lets the mobile app, the desktop app, and the relay
Worker talk to each other. Pure TypeScript + TypeBox, **zero** runtime deps on
Electron / React Native / partysocket — every consumer imports the same source.

> **Read [`PROTOCOL.md`](./PROTOCOL.md) first.** It is the spec: the full message
> catalog, routing, pairing flow, and trust boundaries. This README is the map of
> the code that implements it.

## Modules

```
src/
  protocol.ts     Wire protocol v1 — TypeBox envelopes, parseMessage /
                  serializeMessage, PROTOCOL_VERSION, MAX_MESSAGE_BYTES
  pairing.ts      Pairing credentials — generate / parse / hashToken
  room.ts         Room addressing + connect-time auth (parseConnectionAuth,
                  buildConnectionConfig, PARTY_NAME, server host resolution)
  connection.ts   Connection-attempt registry (cancel stale reconnects)
  *.test.ts       Vitest suites for each
```

No barrel — import by file:

```ts
import { parseMessage, serializeMessage, PROTOCOL_VERSION } from "@repo/dispatch/protocol";
import { parsePairingString, hashToken } from "@repo/dispatch/pairing";
import { buildConnectionConfig, parseConnectionAuth } from "@repo/dispatch/room";
```

## The shape of the contract

- **Every frame** is a flat discriminated union on `type`, each carrying `v: 1`.
  No `Record<string, unknown>` payloads. Senders build a literal `DispatchMessage`
  and `serializeMessage`; receivers `parseMessage` at the trust boundary and
  switch on the typed result.
- **Versioning is checked first.** The three peers ship independently, so a
  `version_mismatch` is rejected loudly rather than misread.
- **Pairing credential** = `roomId.token` shown as one copyable string. `roomId`
  is 80 bits CSPRNG (and doubles as the relay room name); `token` is the 128-bit
  bearer secret. The Worker stores only `hashToken(token)`. Runtime requirements
  are isolated per function so each consumer's environment only pulls what it can
  run (mobile only calls the pure `parsePairingString`).

## Test / typecheck

```bash
pnpm --filter @repo/dispatch test
pnpm --filter @repo/dispatch typecheck
```

## Changing the protocol

Bump `PROTOCOL_VERSION` on any breaking message-shape change, update the catalog
in `PROTOCOL.md`, and add/adjust the TypeBox schema + tests. All three peers
(`apps/desktop`, `apps/mobile`, `apps/server`) must ship the new version together.
