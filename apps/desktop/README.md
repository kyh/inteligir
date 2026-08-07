# `@repo/desktop` — the Electron shell

A window on the hosted product, and nothing else. There is no vault here, no
agent, no index and no renderer of our own: the page comes from the deployment
this shell wraps (`apps/web`), and this process contributes the things a browser
tab cannot — a dedicated window, the `inteligir://` scheme, a tray, a summon
shortcut, and updates OF THE SHELL.

Modelled on how any desktop app wraps a web app. The one rule that makes that
safe is that it must never become a browser.

## Layout

```
src/
  main/
    index.ts             app lifecycle — window, tray, global shortcut, updater
    app-url.ts           WHICH deployment this shell wraps (pure)
    navigation-guard.ts  the origin pin, the popup deny, the .pdf frame gate (pure)
    deep-link-route.ts   inteligir:// → /app/link?verb=… (pure)
    deep-link.ts         the OS glue around it (open-url, argv, scheme registration)
    updater.ts           electron-updater wiring
  __tests__/             Vitest — every pure module above, no Electron env needed
resources/               icons + entitlements shipped in the .app
```

## The one rule

The window loads exactly ONE origin and stays on it. Top-level navigation away
from it is blocked (http(s) targets are handed to the system browser instead),
and `window.open` is denied unconditionally. A shell that can be navigated
anywhere is a browser carrying the user's credentials in it, wearing the
product's chrome — so the policy is pure, unit-tested, and the whole security
surface of this process.

The origin itself comes from exactly two places, in order:

1. `INTELIGIR_APP_URL` in the environment — how you point a local build at
   `pnpm dev:web`.
2. The same variable at BUILD time, baked in by `electron-vite`'s `define`.

Then `https://inteligir.com`. Anything that is not an http(s) URL is refused
rather than coerced, and nothing the page can influence is ever consulted:
a shell whose target can be changed from inside the page it loaded is the same
failure as the one above.

## Deep links

`inteligir://` is world-invokable — any web page can launch it — so the shell
never acts on a link. It validates the URL against the scheme's one grammar
(`@repo/bridge/deep-link`, the same parser the Worker runs) and re-emits it as
`/app/link?verb=…`, built from the parsed verb with a named parameter each,
never by forwarding the query whole. The client page at that route reads it and
calls the Worker with the user's own bearer.

`session` is dropped rather than translated: it completed a social sign-in for a
host that had minted the state nonce, and this shell holds no session.

## Dev

```bash
INTELIGIR_APP_URL=http://localhost:5174 pnpm dev:desktop
```

Opens the window with CDP on 9222 — `agent-browser connect 9222` attaches to it.
F12 toggles devtools in a dev build.

## Packaging

`electron-builder.yml`. macOS only today: dmg + zip (the zip is what
electron-updater installs from — dropping it strands every shipped install on
its version), hardened runtime, notarized, with the Electron fuses that disable
`ELECTRON_RUN_AS_NODE`, `--inspect` and `NODE_OPTIONS`.

Use the `release` skill to cut one. A release ships the SHELL: what a bump
changes is the window and its update feed, never the product.
