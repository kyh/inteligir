# Decisions: @repo/cli

The `inteligir` command: the connector's tools as commands, for a person at a
shell or a script. It holds no tool of its own, so the library's rows tagged a
tool are its whole surface (`packages/service/CLAUDE.md` § The connector).

- **The command is a client of `/connector` and nothing else: it lists the
  tools the connector serves and calls them by name, with no per-tool code.**
  A tool added to the connector reaches the command with no release of it, and
  the command does nothing an assistant can't (owner decision: a thin wrapper
  over the connector). `apps/cli/src/commands.ts`.
- **It signs in as an assistant does, by the MCP SDK's OAuth client: dynamic
  registration as a native client, PKCE, and a code returned to a loopback
  listener on `127.0.0.1`, any port.** The provider matches a native client's
  loopback redirect by everything but its port (RFC 8252 § 7.3), the consent
  page already warns a loopback grant goes to an app on this computer, and the
  person disconnects it in Settings like any assistant.
  `apps/cli/src/connector-auth.ts`.
- **What it keeps is one file, `$XDG_CONFIG_HOME/inteligir/credentials.json`
  (`~/.config` unset), written 0600 under a 0700 folder: the site, its client
  registration and its tokens.** The refresh token is a month of the person's
  library, so no other account on the machine reads it; a sign-in keeps the
  registration, so each one adds no assistant row. `apps/cli/src/credentials.ts`.
- **An argument is `name=value`, read as text where the tool's input schema
  says a string and as JSON elsewhere, or one JSON object whole.** A title of
  `42` stays text, and a list or a number needs no quoting rules of our own.
  `apps/cli/src/tool-args.ts`.
- **A tool's structured answer prints as JSON, its refusal goes to stderr with
  exit 1, and a usage error or a missing sign-in exits 2.** A script pipes the
  answer to `jq` and tells a refusal from a typo.
  `apps/cli/src/commands.ts`.
- **It ships as one file Vite bundles, `dist/inteligir.js`, with the contract
  inlined and the SDK and zod as dependencies.** The contract is TypeScript
  Node won't strip under `node_modules`, and a publish names only what npm can
  install. `apps/cli/vite.config.ts`.
