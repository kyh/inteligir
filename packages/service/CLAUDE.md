# Decisions: @repo/service and the cloud

The cloud's code, which `apps/web` serves on Node: the environment it reads and
accounts. It imports no React and no DOM (`oxlint.config.ts`). Another area's
decisions port with its code from the tag `cloudflare-last`.

## The environment

- **Every key the cloud reads is one zod schema, each optional or defaulted.**
  A missing key turns its feature off instead of crashing boot, while a value
  that is there but wrong fails it: a flag takes only `true` or `false`, the
  build floor only a release version, `resend` only with its key and sender.
  `packages/service/src/env.ts`.
- **`turbo.json`'s `globalEnv` and `.env.example` name exactly the keys the
  schema parses.** turbo hands a task only the variables it lists, and the
  example is the one list a deployer reads, so a key added to one and not the
  others fails a suite. `packages/service/src/env.test.ts`.

## Accounts and sessions

- **The account's devices are its sessions, in one list any of them reads and
  ends.** A lost phone goes from Settings › Account with no password, and Better
  Auth's own list routes would hand each session's token to the browser; a
  sign-in past the twentieth ends the one used longest ago.
  `packages/service/src/auth/session-devices.ts`.
- **An account is deleted from any signed-in device, the password asked again,
  through Better Auth's `deleteUser`** (owner decision: whoever lost their Mac
  deletes from any Mac). Its rows go by cascade and its `beforeDelete` forgets
  the invite's redeemer; a session alone never deletes, since a stolen one could.
  `packages/service/src/auth/delete-account.ts`.
- **Sign-up is invite-gated by `POST /api/sign-up`, which claims the code in one
  update, forwards to a second Better Auth instance and releases the claim if
  the sign-up fails.** Better Auth reads `disableSignUp` per instance, so the
  public one refuses sign-up outright. `packages/service/src/auth/invite.ts`.
- **The auth door answers the six Better Auth routes a client calls, by method
  and path, and a plain 404 to every other.** A list of routes to shut leaves
  open the one a release adds. `packages/service/src/auth/auth-route.ts`.
- **Better Auth's `baseURL` is the deployment's one origin, `APP_URL` or
  Vercel's production or preview URL, never a request's host.** A reset link
  minted from a forged `Host` would carry its token to another site.
  `packages/service/src/app-url.ts`.
- **Only Better Auth's own read slides a session.** A row and its cookie slide
  together or not at all, so the app's own reads pass `disableRefresh`.
  `packages/service/src/auth/auth.ts`.
- **Every device signs in with Better Auth's own session** (owner decision: the
  extension rides the browser's sign-in, its cookie's signed value as a bearer).
  A credential of our own is a second secret, verifier and list.
  `packages/service/src/auth/auth.ts`.
- **The limiter counts in Postgres's `rate_limit`, and the app's own windows on
  that table never outlast Better Auth's 60 s.** In memory a count is per
  instance; Better Auth prunes a row older than its longest window, which would
  reset a longer one mid-count. `packages/service/src/rate-limit.ts`.
- **On Vercel the caller's address is `x-vercel-forwarded-for`'s.** The edge sets
  it, while a client can send any `x-forwarded-for` chain.
  `packages/service/src/auth/client-ip.ts`.
- **Mail goes from `EMAIL_FROM` through Resend only when `EMAIL_MODE=resend`;
  unset, a deployment logs it outside production and sends nothing in it.** A
  log in production would hold live reset links, and with mail off a reset is
  refused up front rather than promising a link. No sender is built in (owner
  decision pending). `packages/service/src/auth/send-email.ts`.
