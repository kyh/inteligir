# pi harness quarantine

**These files are the ONLY place in `@repo/agent-container` allowed to import
`@earendil-works/pi-ai` or `@earendil-works/pi-coding-agent`.** Everything else
in `src/` — the daemon, the reporter, the vault watcher, the browser tool —
speaks the image's own vocabulary (`ContainerTool`, `AgentReport`,
`ContainerTurn`) and never names a pi type.

Why: pi is a fast-moving framework and this image is the only place in the repo
that runs it. When pi moves an export, changes a session's lifecycle or renames
a runtime hook, exactly two files here change and nothing else does.

What lives here:

- `provider.ts` — the `ModelRuntime` and the single custom provider the turn
  streams through, including the egress identity header the sandbox's outbound
  interception reads.
- `session.ts` — the session's lifecycle: resources, tools, seeding, one turn
  from prompt to end.

The rule is a boundary, not a preference, and it is enforced:
`tools/repo-guards/src/pi-quarantine.test.ts` walks `container/src` and fails on
a `@earendil-works/pi-*` import specifier outside this folder. It matches
imports only — `../tools.ts` names pi in prose, describing the vocabulary this
quarantine exists to keep. This package has no test script of its own, so the
guard lives with the repo-wide ones.

If a new capability needs a pi type, add a file here and export the image's own
shape from it — do not import pi upward.
