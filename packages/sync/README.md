# @repo/sync

The desktop's account client: Better Auth against the configured server, plus
the two `~/.inteligir` stores that remember which server and which session.

## Why it exists

An account is OPTIONAL — guest is the default and the account gates cloud
saves and nothing else. This package is the whole client half of that: it
holds no vault state, opens no sockets, and knows nothing about notes. It sits
BELOW `@repo/server` in the dep DAG — it never imports server or electron code
(that would be a package cycle); the one upward need crosses an install seam.
Deps: storage, bridge.

## Layout

```
src/
  sync-account.ts      # SyncAccount: two versioned JsonStores under ~/.inteligir
                       # (sync-config / sync-auth), Better Auth email+password +
                       # sign-up, social OAuth initiate/complete (state nonce),
                       # password reset, capabilities probe.
```

Exports map: `./sync-account` only.

## Invariants

- **The server URL is per-install configuration.** There is no default and no
  allowlist — a self-hoster points at their own Worker — so every call refuses
  as a VALUE (`{ok:false}`) until one is set, never a throw.
- **Social sign-in is nonce-bound**: one in-memory pending (128-bit state,
  10-min TTL, single-use); a mismatched state is refused WITHOUT burning the
  pending; the deep-link `code` is opaque, exchanged over HTTPS — never a raw
  token. No installed browser opener → refuse as `{ok:false}`.
- **Password reset is existence-blind**: `ok` means "request accepted", never
  "that email exists", and the UI shows its own fixed copy either way.
- **Sign-out touches the session store only.** The server URL survives; it is
  configuration, not a credential.

## Seams

- `setSyncBrowserOpener` — system-browser opener for social sign-in, filled
  once by the composition root (`packages/server/src/boot/create-host.ts`
  passes the guarded `openExternalHttpUrl`) and read at CALL time, so it
  survives a logout/login reset. Uninstalled = refuse, never a package-owned
  launcher.
- `SyncAccountOptions` — store paths, a `StoreAdapter`, and an `openExternal`
  override, so tests never read the real `~/.inteligir` or launch a browser.

## Testing

```bash
pnpm --filter @repo/sync test
```

Notable pins: every call refuses before any network when no server URL is set;
`set-auth-token` capture on sign-in/sign-up; the state nonce is single-use and
a wrong state does not burn the pending; the exchange sends the opaque code and
nothing else; sign-out clears only `sync-auth.json`.
