# Plan 022: Follow-ups cluster — small debts from plans 013-015

> Draft-quality plan (backlog): four independent S items; dispatch together
> or cherry-pick. Refresh excerpts against HEAD before dispatch.

## Status

- **Priority**: P3
- **Effort**: S each (4 items)
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt / polish
- **Planned at**: `9f5f5e94`, 2026-07-08

## Items

1. **HTML-app token revocation** (from 015 review): `vault-app://` tokens
   are FIFO-bounded (32) but never revoked when an app closes. Add
   `revokeHtmlAppToken(token)` called from the view's unmount/close path
   (registry channel + handler + fixture stub). Keep the FIFO as backstop.
2. **Background sync passes surface conflicts immediately** (from 014):
   engine-internal debounced passes don't push their outcome to the
   coordinator's state, so a background-pass conflict only appears on the
   next explicit pass or boot seed. Route every pass outcome (the engine has
   it) through the same conflicts-accumulate path `syncNow` uses.
3. **`getForwardLinks` decision** (from the original audit): the IPC channel
   has no UI consumer. Either add a "Links" list beside Backlinks under the
   editor (S; knowledge engine already computes it) or delete the channel +
   handler + fixture line. Operator picks; default = add the panel (the data
   is free and it completes the links story).
4. **`_plan015-test` residue check**: verify no test folders/files remain in
   the real vault or fixture from executor runs (`grep -r "_plan01" apps
packages` + a vault listing check in the report).

## Verification

Per item: unit/integration test where behavior changed (token revocation
test; a background-pass conflict test mirroring the syncNow one); harness
check for the links panel if chosen. Full canonical gate once at the end.
