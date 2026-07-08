# Architecture Decision Records

One file per durable decision: context, the decision, options considered,
consequences (including the debts it creates). When a decision is replaced,
the old ADR stays — mark it `Status: superseded by ADR-NNNN` at the top with
one line on why. The chain is the point: it stops re-derivation of dead ends.

Vocabulary used in ADRs is defined in `/CONTEXT.md`; current architecture is
summarized in `/CLAUDE.md`. An ADR records WHY, not HOW.

| ADR  | Title                                                                        | Status                               |
| ---- | ---------------------------------------------------------------------------- | ------------------------------------ |
| 0001 | Ephemeral vault index — no recursive watcher                                 | accepted (implementation: plans/016) |
| 0002 | HTML Apps run as sandboxed iframes with host-injected deps and a file broker | accepted (implementation: plans/015) |
