# CONTEXT.md — the domain glossary

What the words mean. `CLAUDE.md` § Decisions records **why a choice was made**;
this records **what a term names**, where it lives, and — the part worth
reading — the neighbouring concept it gets confused with.

Rules for this file: every entry points at the module that OWNS the concept
rather than restating its implementation, because the module's own header is the
detail and this is the map. An entry that cannot be checked against code does not
belong here.

---

## The object

**host** — `UserHost` (`apps/web/src/worker/host/user-host.ts`), one Durable
Object per account. It is not a server tier: it holds one user's vault manifest,
JsonStores, knowledge index, chat transcript, tickets and background lane, and
every Bridge method runs inside it. "Host-side" therefore means "inside that one
user's object", not "on the backend".

**client** — anything holding a `Bridge` (`@repo/bridge/client`): the workspace
page, a companion app, a test's fixture Bridge. Not "the browser" — the Electron
shell and the Expo app are shells around a client, and the workspace itself does
not know which one it is running in.

**the alarm** — a Durable Object has exactly ONE pending alarm, so every deadline
multiplexes through `HostAlarm` (`host/host-alarm.ts`): a list of concerns, each
a `sweep` plus the `dueAt` it next needs waking for, re-armed at the earliest.
Concerns today: unauthenticated-socket reaping, ticket expiry, the trash sweep,
the capture inbox, routines, and index continuation. It is NOT a scheduler you
can add a timer to — a concern that calls `setAlarm` for itself silently cancels
whatever was armed, and a `setTimeout` pins the object out of hibernation.
(`CLAUDE.md` § Decisions, "The object has ONE alarm".)

---

## The vault

**vault** — one per account: the user's markdown files, and the only durable
user-owned store this product has (skills and standing instructions live in it
too). It is not a folder on a disk anywhere. It is a manifest plus a set of R2
objects, and the three things that look like "the vault" are distinct:

- the **manifest** is the authority (below);
- **R2** holds the bytes, keyed by folded path under the object's own prefix —
  it is a blob store with no notion of which bytes are live, which is why there
  is no bucket lifecycle rule;
- what the **container materializes** under `./vault`
  (`apps/web/container/src/vault-materialize.ts`) is a per-wake COPY, deleted
  whenever the container sleeps. Nothing written there is durable.

**manifest** — the `vault_files` table in the object's own SQLite
(`host/vault/user-vault.ts`): one row per path, carrying `version`,
`content_hash`, `size` and `deleted_at`. It IS the listing — the object is the
only writer, so there is nothing to crawl and nothing to watch. Qualified
`vault_files` because the knowledge index's core schema owns the unqualified
`files` in the same database. Not to be confused with the agent's **tool
manifest**, which is the tool list a container is handed at boot.

**path vs path key** — `path` is the display spelling; `key` is the identity:
NFC-normalized, lowercased, `/`-separated (`host/vault/vault-key.ts`). The
manifest's primary key and the R2 key both derive from `key`, which is what makes
`Note.md` and `note.md` one file and a case-only rename a pure retitle. A guard
written against the local case-insensitive-filesystem hazard would guard nothing
here — R2 keys are case-sensitive, so the failure is two live objects, not one
clobbered file.

**entry** — one row of the listing: `VaultEntry { path, name, kind }`
(`@repo/bridge/vault`). `kind` is `"doc"` or `"other"` and nothing else; size and
mtime are deliberately absent (a separate per-file question, `getVaultFileFacts`).

**doc** — a file whose extension is editable text: `.md`, `.markdown`, `.mdx`,
`.txt` (`@repo/notes/knowledge/doc-file`, the single source of that answer).
"Doc" is a CLASSIFICATION, not a shape: it decides what the index projects, what
a rename rewrites links in, and what a vault change announces bytes for.

**note** — a doc as a user and the knowledge surfaces address it: the filename IS
the title, there is no slug layer (`@repo/notes/knowledge/note-name`).
`NotePathSchema` is asked for where the answer only makes sense for a note (the
knowledge queries); `VaultPathSchema` is asked for where the handler acts on
whatever the path names. **Ambiguity worth knowing**: the channel `readVaultFile`
takes `VaultPathSchema`, so "doc" in a channel NAME is looser than `isDocPath` —
read the schema, not the name.

**version** — per FILE, on its manifest row, bumped by every write and move. It
is optimistic concurrency: a caller that supplies `baseVersion` gets a
`version-conflict` VALUE back rather than a throw. The editor's autosave writes
unconditionally; a rename's link rewrite writes conditionally.

**revision** — per VAULT, and a different thing entirely: a monotonic counter
over `agent_vault_log` (`agent/vault-revisions.ts`) that exists for exactly one
purpose — letting a waking container materialize a delta instead of the whole
vault. It is bounded (5,000 entries) and the fallback past the window is "send
everything". A revision is not a manifest version, cannot be compared to one, and
means nothing outside the container-materialization path.

**tombstone** — a manifest row with `deleted_at` set. Its bytes are still in R2
and its path is still taken; the host's alarm purges row-then-blob after the
retention window. Three states, not two: `StoredFile` splits `live` and `trashed`
as separate variants, and **absent** is `null` from the lookup — a third thing
again. A tombstone is not a namespace reservation: writing or moving over one
consumes it.

**held** — the deletion gate's refusal (`HeldDeletions`), a `{ ok: false }` value,
never an error. It reads a COUNT over a rolling window, never a cause. See
`CLAUDE.md` § Decisions, "ONE deletion gate".

---

## The text

**line** — a line's content EXCLUDES its terminator, whichever flavor
(`\r\n`, `\r`, `\n`). That rule is stated once, in
`@repo/notes/knowledge/source-lines`, and it has **two readings that must name
identical bytes**: `splitLines` reads lines as VALUES, `lineSpan` reads one as a
POSITION. The split cannot be used to write — joining back would rewrite every
terminator in the file, so a CRLF doc saved after ticking one box would come back
with every line changed. So the guarded write scans EOLs in place and splices
inside the span. Their agreement is pinned by that module's own test; a third
reading of "what a line is" anywhere else is a file-corruption bug waiting to
happen.

**task ordinal** — a checkbox in a markdown file has no id, so everything that
points at one points at its POSITION among the file's GFM task items, in document
pre-order, checked items included. `(sourceFile, ordinal)` is delegation's
anchor, the Tasks view's address and the agent's `toggle_task` target.
`@repo/notes/knowledge/task-ordinal` owns the count and every question asked of
it. **Two callers, two state rules, one count**: `openTaskAtOrdinal` refuses an
already-checked item (handing a finished task to a background agent is work
nobody asked for), `toggleTaskAtOrdinal` takes either state (unticking is half of
what toggling means). They may disagree about permission and never about which
item. An ordinal is not a line number and not an offset — lines shifting above it
relocate the item, which is the whole point; the raw-byte guard is what catches
the item itself changing.

The count is over the editor's grammar, not CommonMark's
(`@repo/notes/markdown/scan-parse` disables `codeIndented` and `htmlFlow`),
because the editor counts the same items over the live Plate tree and the two are
pinned in lockstep.

**projection** — what ONE parse of a doc yields: title, headings, links, tags,
aliases, tasks (`@repo/notes/knowledge/projection`, `projectDoc`). The index
stores projections, not documents. Projection is a WRITE — it happens on the way
out of the mutation that carried the bytes, not from a crawl or a diff
(`CLAUDE.md` § Decisions).

**opaque node** — what the editor does with a construct it cannot model (raw
HTML, a `{…}` expression, unknown JSX): `@repo/notes/markdown/remark-opaque`
replaces it at parse time with a node holding that construct's markdown as a
STRING, rendered as inert literal text and emitted back unescaped. It is what
makes Rich the default surface for anything that PARSES, and Raw a fallback for
genuinely malformed input alone. The value is RE-SERIALIZED from the node, never
sliced out of the source — a slice inside a blockquote captures the `> ` markers
the stringifier then adds again.

**private note** — `private: true` in frontmatter. A client-side gesture that
keeps a note out of the app's own AI surfaces (editor AI, ghost text, read-aloud,
the chat context hint), fail-closed on the live buffer. It is NOT enforced by the
host, does not filter search or the knowledge tools, and does not stop the agent
reading the file. `docs/privacy.md` is the contract — do not restate it.

---

## The wire

**channel** — one row of `@repo/bridge/ipc-registry`, in one of four kinds
(`ipc-entry.ts`): `invoke`, `invoke-void`, `send`, `event`. The `Bridge` type, the
host's required-handler set and the event partition are all DERIVED from that
table. Adding a channel is four compile errors and one test; a capability this
host does not have has no channel at all.

**boot bundle** — `getWorkspaceBoot` → `WorkspaceBoot { root, entries, uiState,
openNote }`: the whole first paint in ONE round trip. The three questions have one
answer and asking them separately is three sequential trips to the same object.
`openNote` is resolved HOST-side from ui-state's own `workspace.openNote` key, so
the client never has to learn which note it wants before it can ask for it.
Client-side it is one shared promise keyed on the Bridge
(`@repo/workspace/stores/workspace-boot`), never re-fetched and never cached on
rejection.

**ticket** — the credential a Bridge socket authenticates with, in its first
frame: 32 random bytes minted at `POST /v1/host/ticket` against the session, valid
one minute, spent exactly once by a `DELETE … RETURNING` inside the object
(`host/socket-ticket.ts`). It is NOT a session: a session is Better Auth's cookie
or bearer and outlives everything; a ticket is worth one socket and carries no
identity to compare, because only the object that verified the session can mint
one. The raw session token stays out of the page as a result.

**client class** — `web` or `mobile` (`host/client-class.ts`), decided ONCE at
the mint, from WHICH CREDENTIAL carried the session: cookie + allowlisted Origin
is `web`; bearer + no Origin at all is `mobile`; both remaining combinations
refuse. It is never derived from a header a caller sets (or omits) for free.
`web` is blanket-granted the whole host surface; `mobile` reaches only
`REMOTE_ALLOWED_METHODS`/`_EVENTS` (`@repo/bridge/channel-policy`), an allowlist
enforced at dispatch, at broadcast and at reconnect hydration. This is not the
agent's policy — see **grant tier**.

**hydration** — two unrelated meanings, both current:

- **reconnect hydration** re-pushes a stateful event's current value to a client
  that reconnected, resolved through the getter `HYDRATED_EVENTS` pairs it with.
  It is not event replay; that is deliberately not provided.
- **index hydration** rebuilds the in-memory link graph from SQLite rows
  (`host/knowledge/user-knowledge.ts`). Because the object hibernates, this is
  the NORMAL path on nearly every query, not a boot optimization.

**the open note's path — three answers that legitimately disagree.** During a
load they are not the same string, and using the wrong one is a real bug shape:

- `openPath` (`@repo/editor/note/open-note-store`) — the note the UI INTENDS
  open. Published as soon as its runtime is created, before any bytes arrive.
- `editor.path` — the note the runtime actually HOLDS. `null` while the
  controller is still reading the file, which is why the capture applier reports
  "no buffer" rather than acking an apply that never persisted.
- `workspace.openNote` in ui-state (`UI_STATE_OPEN_NOTE_KEY`) — what the NEXT
  boot will resolve bytes for. The one ui-state key spelled on both sides,
  because a freshly seeded vault has to say which file to land on.

---

## The agent

**lane** — `chat` or `background` (`agent/agent-runner.ts`). Two lanes are two
CONTAINERS, and the reason is write attribution: the container reports the
agent's file writes from a filesystem watcher, which cannot say which session
wrote a file, so two pi sessions over one `./vault` would make every write
ambiguous between an attended edit the chat toast can undo and an unattended one
the delegation dock owns. Two containers make the lane a fact of the CREDENTIAL —
each boots with its own report bearer and the report path derives the lane from
the token, never from anything the caller says. Everything else is shared and must
be: one vault, one index, one snapshot store, one durable background lock.

**boot** — a container GENERATION (`bootId`, per lane). The report bearer is bound
to it, so a token from a container that has since been replaced is refused. Not
the boot bundle, and not the object waking.

**turn** — one dispatched agent run. The object NEVER awaits one: `send` resolves
as soon as the container accepts, and everything the turn produces arrives later
as separate short authenticated reports that fold into the transcript and
broadcast. So "the agent is busy" is durable state, not a field — the object
hibernates between a turn's own reports.

**steer** — a message folded INTO the turn already in flight (pi's `session.steer`)
rather than queued behind it (`follow_up`). Both are `TextChatMessage` variants;
the composer decides which by whether the user asked to send now while busy. The
daemon's own corrections — notably the vault refusing a write the agent's file
tools already reported as done — are steered too, because the model has to see
them while the turn can still act.

**grant tier** — what the agent may do is DECLARED in `@repo/bridge/agent-grants`,
one row per capability, across four tiers:

- `read-projected` — reads answered from the knowledge index; every one is paged.
- `write-checkpointed` — mutations its own file tools cannot express; each
  captures a restore point first, fail-closed.
- `delegate` — handing work to the background lane. Capped per turn, being the
  one capability that manufactures agent TURNS.
- `destructive-confirmed` — the model PROPOSES and a human answers. **This is the
  tier that raises a confirmation**, and it is raised inside the executor,
  host-side, so no container can skip it.

Plus a never-granted set, DECLARED and grouped by reason, whose `why` is rendered
into the bundled instructions so a denial is stated to the model rather than met
with silence. This is not `REMOTE_ALLOWED_METHODS`: a companion client reaches the
identical handler, so a list of names is a complete policy there; the agent never
touches a window handler at all, so every row is implemented separately in
`agent/agent-tools.ts`. It is policy, not a sandbox — the model has a shell
(`CLAUDE.md` § Decisions).

**restore point** (a.k.a. snapshot) — an R2 copy of a file's bytes plus a row,
taken BEFORE an agent write, scoped `(origin, ref)` where origin is `chat`,
`delegation` or `routine` (`agent/agent-snapshots.ts`). Newest 50 per origin, so a
chatty conversation can never evict a background run's undo point. A restore
writes back THROUGH the vault, so the manifest, the index and the deletion gate
all see an ordinary write. A restore point for a file that did not exist is
`create`, and undoing it tombstones rather than writing zero bytes.

**delegation** vs **routine** — siblings on the same background lane and the same
durable lock, split by RISK SHAPE, and their write paths differ because of it:

- A **delegation** (`background/delegations.ts`) is a `- [ ]` line the user (or
  the chat agent) hands over. Someone asked for it just now, so the AGENT writes:
  it edits the file with its own tools. The anchor is re-resolved against current
  bytes at dispatch and refused if the text moved.
- A **routine** (`background/routines.ts`) is a saved prompt plus a schedule, fired
  unprompted by the alarm. Nobody is watching, so the HOST writes: the agent is
  asked to reply with markdown and the host appends it, and an epoch guard makes a
  run that was disabled or deleted mid-flight write nothing at all.

Both capture a pre-run restore point; only the routine's write path is host-owned,
and that asymmetry is the design rather than an inconsistency.
