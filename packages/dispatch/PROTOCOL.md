# Dispatch protocol v1

Wire contract between the desktop (agent host), the mobile app (remote
surface), and the relay Worker (`apps/server`, a partyserver Durable Object).
Source of truth: `src/protocol.ts` (messages), `src/pairing.ts` (credentials),
`src/room.ts` (connection auth).

## Envelope

Every frame is JSON text, ≤ `MAX_MESSAGE_BYTES` (256 KiB) UTF-8, shaped as one
member of the `DispatchMessage` discriminated union: `{ v: 1, type, ...fields }`.
Receivers parse with `parseMessage` (never throws, typed errors) and reject
wrong version → `error{version_mismatch}` ("upgrade required"), unknown type,
malformed payload, or oversized frames. Unknown _extra fields_ on known types
are tolerated (forward compatibility); unknown _types_ are not.

## Message catalog

| Type            | Direction                  | Purpose                                                                                                                                                                                                 |
| --------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_message`  | mobile → desktop           | Start/queue an agent turn (`text`)                                                                                                                                                                      |
| `steer`         | mobile → desktop           | Redirect the in-flight turn (`text`)                                                                                                                                                                    |
| `interrupt`     | mobile → desktop           | Abort the in-flight turn                                                                                                                                                                                |
| `agent_event`   | desktop → mobile           | One transcript event (`event`: nested union — `agent_start`, `agent_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_end`, `queue_update`, `turn_error`) |
| `chat_message`  | gateway (DO) → desktop     | Correlated external chat turn (`correlationId`, `text`, `conversation?`)                                                                                                                                |
| `chat_reply`    | desktop → DO               | Resolves the waiting gateway POST; intercepted, never relayed                                                                                                                                           |
| `presence`      | server → connecting client | Snapshot of other peers' roles in the room                                                                                                                                                              |
| `peer_joined`   | server → room              | An authenticated peer joined (`role`)                                                                                                                                                                   |
| `peer_left`     | server → room              | An authenticated peer left (`role`)                                                                                                                                                                     |
| `room_teardown` | desktop → server           | Rotate: delete stored credential hash, notify + close all peers                                                                                                                                         |
| `error`         | server → client            | Typed error: `version_mismatch`, `unauthorized`, `invalid_message`, `payload_too_large`, `rate_limited`, `room_closed`                                                                                  |

Routing: the Worker is a dumb relay — a validated frame from one authenticated
peer is forwarded verbatim to every other authenticated peer in the room,
except `chat_reply` and `room_teardown` (handled by the DO) and
`presence`/`peer_joined`/`peer_left`/`error` (originated by the DO). Peers
ignore types not addressed to their role.

## Pairing

Remote Access is **opt-in** and OFF by default; the desktop never connects to
the relay until the user enables it. Enabling mints a credential
(`generatePairingCredential`):

- `roomId` — 16 chars, 32-char alphabet (no I/O/0/1), 80 bits CSPRNG. Doubles
  as the room name.
- `token` — 16 CSPRNG bytes, base64url (22 chars), 128 bits. Bearer secret.

Shown to the user as one string: `XXXX-XXXX-XXXX-XXXX.token`
(`formatPairingString` / `parsePairingString`).

```
Desktop                    Worker (DO per roomId)              Mobile
  | generate credential        |                                  |
  |-- WS connect ------------->|  role=desktop&token=... (query)  |
  |                            |  no stored hash yet:             |
  |                            |  store SHA-256(token)  = CLAIM   |
  |<-- presence (peers: []) ---|                                  |
  |                            |   user types pairing string ---->|
  |                            |<------------- WS connect --------|
  |                            |  role=mobile&token=...           |
  |                            |  SHA-256(token) == stored hash?  |
  |                            |   no -> refuse connection        |
  |<-- peer_joined(mobile) ----|-- presence(desktop) ------------>|
  |    (transcript streaming   |                                  |
  |     now enabled)           |                                  |
  |<========== user_message / steer / interrupt =================>|
  |<========== agent_event stream ===============================>|
```

Rules:

- Auth happens at **connect time** (`onConnect`): wrong/missing token, unknown
  role, or invalid roomId → connection refused. Unauthenticated sockets never
  enter the room.
- First authenticated `role=desktop` connect **claims** the room: the DO
  stores only `SHA-256(token)` (never plaintext) in DO storage. Later connects
  (either role) must present a token hashing to the stored value. Newest
  desktop connection wins if two appear.
- **Rotate** = desktop sends `room_teardown` (DO wipes the hash, broadcasts
  `error{room_closed}`, closes all sockets), then mints a fresh
  roomId + token and claims the new room. Old credentials are dead with the
  old room.
- The desktop forwards `agent_event` frames **only while an authenticated
  mobile peer is present** (tracked via `presence`/`peer_joined`/`peer_left`).
  No peer, no transcript on the wire.

## Trust model

- The **token** is the credential; the roomId only addresses the DO. Both are
  CSPRNG-generated (the legacy 6-char `Math.random` room code is gone).
- The Worker authenticates every connect, validates every frame's shape and
  size, enforces a simple per-connection rate limit, and stores **no message
  content** — only the credential hash and webhook-dedup keys (DO storage, not
  per-isolate memory).
- Clients send the raw token only inside the TLS-protected WebSocket upgrade
  URL. Mobile never needs WebCrypto; hashing happens in the Worker
  (`hashToken`, WebCrypto subtle — Workers/Node ≥ 20).
- The external chat gateway authenticates to the DO via the
  `x-relay-secret` header on its HTTP POST; `chat_reply` is only accepted from
  the desktop-role connection.

## Non-goals (v1)

- **No end-to-end encryption.** The Worker sees plaintext frames, including
  transcripts and commands. Known, accepted limitation. Mitigations: the
  Worker is owner-operated (your Cloudflare account), all hops are TLS, and
  every connection is token-authenticated. Revisit if the relay is ever shared
  by multiple tenants.
- No multi-desktop rooms, no message persistence/replay, no offline queueing:
  a frame relayed while the peer is disconnected is dropped.
- No per-device identity beyond role — any holder of the current pairing
  string is "the mobile".
