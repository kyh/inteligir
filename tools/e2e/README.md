# @repo/e2e — the end-to-end flows

Playwright Test over the built app and the browser extension's dev build.
Outside `pnpm verify`; turbo builds both first.

```sh
pnpm bootstrap                    # once: local Postgres and its schema
pnpm e2e                          # every flow, in Chromium
pnpm e2e -- site                  # one file
pnpm e2e -- -g "sign-in"          # tests whose title matches
pnpm e2e:webkit                   # every flow but the extension's, in WebKit
pnpm e2e:firefox                  # the same, in Firefox
pnpm e2e:mobile                   # the phone's flows, in the iOS simulator (a Mac only)
```

The run needs the Postgres server `POSTGRES_URL` names, read from the root
`.env.local`, then `.env`, unless the shell sets it. `src/databases.ts`, the
run's globalSetup, pushes the schema once into a template database
`e2e_<run>` on that server, and drops it and every clone when the run ends.

`src/app.fixture.ts` gives each Playwright worker one `next start` on a free port
and the built-in agent eve built beside it on another, over its own clone,
`e2e_<run>_<worker>`, started on a fixed set of variables and nothing of the
root `.env`, their output in `test-results/next-start-<worker>.log` and
`test-results/agent-<worker>.log`; the agent answers from eve's mock model,
by the directives `packages/service/src/agent/mock-directives.ts` reads. Each
test:

- `cloud`: the origin, `mint()` for an invite, `mailedResetLink(to)`, the reset
  link the app last mailed, read off its log (`EMAIL_MODE=log`), and `build`,
  the floor the app starts with, which every client here names.
- `web`: a page host of the test's own, whose `pages` map answers the app's
  fetch of each `pageUrl(path)` through `src/page-relay.ts`; any other fetch
  fails the test.
- `account`, signed up by invite and signed in on the test's browser, with
  `library`, a `/v1` client on its own session, and `secondContext`, another
  browser on the same account.
- a watch that fails the test on any page or console error, but those the
  file's `allowedErrors` names.

CI installs the browser with
`pnpm --filter @repo/e2e exec playwright install --with-deps --no-shell chromium`,
a Mac with `pnpm --filter @repo/e2e exec playwright install --no-shell chromium`
(`webkit firefox` too for their runs), and CI runs Chromium alone.

## The engines

`playwright.config.ts` has a project per engine. WebKit stands in for Safari
and the Mac app's engine, never its window: a new window, a download's folder
and the leave prompt are the shell's, which `cargo test` and the owner's Mac
smoke cover. Neither engine loads an extension, so `extension.test.ts` runs in
Chromium alone, and a test that only Chromium can run skips the others by
`browserName`. Firefox empties the clipboard data of a paste a script makes,
so the flows that paste that way skip it (`skipScriptedPaste`).

## The phone

`pnpm e2e:mobile` runs `phone/` under `playwright.phone.config.ts`: one worker,
whose `next start` listens on the port the phone's build was baked with
(`EXPO_PUBLIC_CLOUD_URL`, which the root script names). Turbo builds the site
and `@repo/mobile`'s `simulator` task, a Release `.app` in
`apps/mobile/.simulator`, kept in turbo's cache by that origin.
`phone/simulator.ts` boots a simulator of its own, `Inteligir e2e`, with no
window, installs the build, and runs a flow's YAML in
[Maestro](https://docs.maestro.dev); the spec seeds and reads back through
`/v1`, so Maestro only taps and types. It needs Xcode, Maestro 2.12 or newer on
`PATH` and Java 17 or newer at `JAVA_HOME`:

```sh
brew install openjdk@21 && curl -fsSL https://get.maestro.mobile.dev | bash
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
```

The keyboard covers Sign in, so a flow presses Return to put it away:
Maestro's `hideKeyboard` empties the password field.
