# Decisions: @repo/service and the cloud

The cloud's code, which `apps/web` serves on Node: the environment it reads.
It imports no React and no DOM (`oxlint.config.ts`). An area's decisions port
with its code from the tag `cloudflare-last`.

## The environment

- **Every key the cloud reads is one zod schema, each optional or defaulted.**
  A missing key turns its feature off instead of crashing boot, while a value
  that is there but wrong fails it: a flag takes only `true` or `false`, the
  build floor only a release version, `resend` only with its key.
  `packages/service/src/env.ts`.
- **`turbo.json`'s `globalEnv` and `.env.example` name exactly the keys the
  schema parses.** turbo hands a task only the variables it lists, and the
  example is the one list a deployer reads, so a key added to one and not the
  others fails a suite. `packages/service/src/env.test.ts`.
