# @repo/cli

The `inteligir` command: your library's connector tools, from a shell. Its
decisions are this package's [`CLAUDE.md`](CLAUDE.md), and the repo's commands
`docs/development.md`.

```sh
pnpm cli sign-in --site http://localhost:5174   # against pnpm dev:web; the site by default
pnpm cli tools                                  # what the connector serves
pnpm cli help search_library                    # what a tool takes
pnpm cli search_library query="garden plans"    # name=value, or one JSON object
pnpm cli sign-out
```

## Layout

```
src/main.ts            the entry: process arguments in, an exit code out
src/commands.ts        sign-in, sign-out, tools, help and calling a tool
src/connector-auth.ts  the OAuth client provider, the loopback listener and the browser opener
src/credentials.ts     the one file the sign-in is kept in
src/tool-args.ts       name=value words into a tool's arguments
```
