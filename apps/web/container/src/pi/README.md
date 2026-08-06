# pi harness quarantine

**These files are the ONLY place in `@repo/agent-container` allowed to import
`@earendil-works/pi-ai` or `@earendil-works/pi-coding-agent`.** Everything else
in `src/` — the daemon, the reporter, the vault watcher, the browser tool —
speaks the image's own vocabulary (`ContainerTool`, `AgentReport`,
`ContainerTurn`) and never names a pi type.

Why: pi is a fast-moving framework, and this image is one of two harnesses the
project runs it under. When pi moves an export, changes a session's lifecycle or
renames a runtime hook, exactly two files here change and nothing else does. The
desktop keeps the same rule in `packages/agent/src/pi/` for the same reason.

What lives here:

- `provider.ts` — the `ModelRuntime` and the single custom provider the turn
  streams through, including the egress identity header the sandbox's outbound
  interception reads.
- `session.ts` — the session's lifecycle: resources, tools, seeding, one turn
  from prompt to end.

The rule is a boundary, not a preference. If a new capability needs a pi type,
add a file here and export the image's own shape from it — do not import pi
upward.
