# @repo/e2e — the end-to-end flows

Playwright Test over the built app and the browser extension's dev build.
Outside `pnpm verify`; turbo builds both first. Every flow waits in
`playwright.config.ts`'s `PENDING` until its area runs on Next, and the
fixtures below still boot the Worker the tag `cloudflare-last` holds, so the
first flow to leave `PENDING` brings them onto the app.

```sh
pnpm e2e                          # every flow
pnpm e2e -- extension             # one file
pnpm e2e -- -g "Raindrop"         # tests whose title matches
```

`src/fixtures.ts` gives each Playwright worker one Worker on a free port,
beside the scripted Claude (`tools/messages-fake`), and each test:

- `cloud`: the origin and `mint()` for an invite.
- `web`: a page host of the test's own, whose `pages` map answers the Worker's
  fetch of each `pageUrl(path)`; any other fetch fails the test.
- `account`, signed up by invite and signed in on the test's browser, with
  `library`, a `/v1` client on its own session, and `secondContext`, another
  browser on the same account.
- a watch that fails the test on any page or console error, but those the
  file's `allowedErrors` names; `cloudOptions` overrides a binding per file.

Teardown fails when the Worker's Claude dropped a thinking block. Nothing
reads `.env` or `.dev.vars`. CI installs the browser with
`pnpm --filter @repo/e2e exec playwright install --with-deps --no-shell chromium`.
