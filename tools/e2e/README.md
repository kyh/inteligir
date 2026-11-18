# @repo/e2e — the end-to-end flows

Playwright Test over the built app and the browser extension's dev build.
Outside `pnpm verify`; turbo builds both first.

```sh
pnpm bootstrap                    # once: local Postgres and its schema
pnpm e2e                          # every flow
pnpm e2e -- site                  # one file
pnpm e2e -- -g "sign-in"          # tests whose title matches
```

The run needs the Postgres server `POSTGRES_URL` names, read from the root
`.env.local`, then `.env`, unless the shell sets it. `src/databases.ts`, the
run's globalSetup, pushes the schema once into a template database
`e2e_<run>` on that server, and drops it and every clone when the run ends.

`src/fixtures.ts` gives each Playwright worker one `next start` on a free port
and the built-in agent eve built beside it on another, over its own clone,
`e2e_<run>_<worker>`, started on a fixed set of variables and nothing of the
root `.env`, their output in `test-results/next-start-<worker>.log` and
`test-results/agent-<worker>.log`; the agent answers from eve's mock model,
by the directives `packages/service/src/agent/mock-directives.ts` reads. Each
test:

- `cloud`: the origin, `mint()` for an invite, and `build`, the floor the app
  starts with, which every client here names.
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
a Mac with `pnpm --filter @repo/e2e exec playwright install --no-shell chromium`.
