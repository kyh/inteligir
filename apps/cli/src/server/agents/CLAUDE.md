# Decisions: agents and threads

Turns, threads, the agent's commits and undo, sign-in, connectors and annotations.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Agents and threads

- **Ingest is ONE transaction.** Append, lifecycle projection and queue touch
  happen in one immediate transaction; notifications flush after commit.
  Lifecycle CAS predicates include the turn identity so a late completion for
  turn A cannot settle turn B. Only `ThreadService` opens a transaction, flushes
  what it notified and dispatches after the commit, since a scripted driver
  re-enters ingest and a transaction cannot nest.
  `apps/cli/src/server/threads/thread-ingest.ts`, `service.ts`.

- **AN AGENT COMMIT STAGES THE TURN'S OWN WRITE SET, AND A TURN IS FOUND BY ITS
  TRAILERS, NEVER BY ITS SHA.** The set is the edits that landed (a failed or
  declined edit stays out, so Undo never takes the user's typing), plus the
  vault writes the agent makes through `inteligir` itself, under a commit hold
  that defers the vault debounce and blocks a sync, because committing the whole
  dirty tree attributes a concurrent turn's writes to whoever settles first. The
  CLI names its thread on every call an agent makes; the header is attribution,
  not authority. A rebase onto another device's push rewrites a sha, so the
  commit carries its thread and turn as trailers, spelled once. Undo needs the
  bytes from just before the turn, so the turn starts with a checkpoint of the
  unclaimed dirty tree: the note the user was typing in lands as the engine's,
  never inside the turn. Undo covers reported edits alone (owner decision).
  Residuals: lines typed into a note WHILE the agent edits it belong to the
  turn, since the canonicalizing save-back leaves no sound per-writer split; a
  crash mid-turn leaves its writes to the boot sweep, so that turn cannot be
  undone; a thread pulled from another device lists only what was committed
  after it arrived. `apps/cli/src/server/agents/agent-commits.ts`,
  `apps/cli/src/server/vault/turn-trailers.ts`.

- **AN ANNOTATION STORE IS ONE DOT-FOLDER KEYED BY THE ITEM'S ID, ITS WRITE IS
  A CAS, AND EVERY ENTRY CARRIES ITS AUTHOR'S `source`; the cloud was rejected
  for it.** Keyed by the item's frontmatter `id`, so a rename or move anywhere
  (Finder, a pull, an agent's `mv`) strands nothing and one commit carries a
  note's anchors and bodies together; bodies in a cloud table would drift from
  the anchors in the note's bytes and need an account. An annotation on a note
  without an id mints one through a guarded note write; a read writes nothing,
  and an `id` that is not text is refused, never overwritten. The annotation-id
  grammar has one spelling (`@repo/notes/annotations/store-schema`). A deleted
  note's store goes with it unless a byte copy still carries that id, one rule
  the server's delete and the phone's both ask, and a restore brings both back.
  A highlight made away from the editor (the CLI, a browser's selection, an
  import, a fill) is placed by its quote: `add` with `place` writes the entry
  first and the markers second, each under its own CAS, so a crash between them
  leaves a highlight that reads as missing, never markers no entry explains; a
  passage the text does not hold is refused before anything is written, and a
  note that changed twice under the markers takes the entry back out. The
  markers are only spliced into the bytes, so taking them out gives the input
  back and two Macs placing one quote write the same bytes; an edge never splits
  what the editor reads as one piece, and a quote the text no longer holds goes
  under `## Highlights` once its fill is final. `remove` with `stripMarkers`
  takes the store's entry first and its markers second, keeping another id on a
  shared pair. Rejected: an anchor of offsets beside the text (every edit moves
  it) and a fuzzy match (two Macs would pick two passages).
  `apps/cli/src/server/annotations/annotations-service.ts`,
  `apps/cli/src/server/annotations/place-quotes.ts`,
  `@repo/notes/annotations/store-removal`.

- **A BYTE COPY IS RE-KEYED AND ITS STORE FORKED, never stripped of its id.**
  Giving a copy its own id copies the store under the new id first, then moves
  the copy's `id:` line under the CAS, so both notes keep every annotation and the
  one keeping the old id keeps its `[[Title|uuid]]` links and actions. Deleting
  the copy's `id:` line was rejected: its anchors' bodies live only under that
  id. `@repo/contract/local/vault/give-note-own-id`.

- **A VIEW CONTEXT RIDES THE MESSAGE, and it is a statement about the past.**
  What the user was looking at travels on the send
  (`@repo/domain/view-context`), never as a thread column or a server-side
  "current view" that has no owner, so navigating away mid-turn changes nothing.
  There is no tool: the agent can already read the file, and the one thing a
  tool could add, a live selection, cannot be made honest. A queued send carries
  none. `apps/cli/src/server/agents/view-context-prompt.ts`.

- **AN @-MENTION RIDES THE SEND AS `contextPaths`, NEVER AS TEXT.** The stored
  message is exactly what the user typed, so the timeline, the phone and a
  thread's title read the message rather than a prefix the desktop glued on; the
  server names the notes in a block of its own. UNLIKE the view context, a
  queued send KEEPS them: a mention is part of what the user asked, not a
  statement about a screen since left.
  `@repo/contract/local/threads/threads-schema`.

- **THE DEFAULT HARNESS IS A STORED CHOICE, read per thread start**, in the data
  dir and not config.json, which is read once at boot and never written by the
  app; unset, claude, whatever PATH holds, since both runtimes ship in the app
  and PATH says nothing about which one can run. A thread keeps the harness it
  started on. A model is per harness, because a model id is vendor-specific. The
  read strips a config.json key it does not name rather than refusing it: the
  window cannot edit that file, so a refusal is a boot nothing in the app
  repairs. `apps/cli/src/server/agents/agent-prefs-store.ts`,
  `apps/cli/src/server/config.ts`.

- **CONNECTORS ARE THE DEFAULT AGENT'S OWN MCP CONFIG**: one registry, the
  vendor's, with the vendor's own sign-in; an app-owned registry with hand-built
  OAuth was the rejected alternative. Settings edits the servers in the default
  agent's user-level config through its bundled binary, so a change of agent
  moves the section and every vault shares the list. Add and remove only: no
  toggle, and no header field, since Codex keeps no static header. A session is
  handed no servers of the app's, so the config Settings edits is the one a
  session loads. A plain list answers from the last read for ten seconds,
  because reading codex's spawns it and runs OAuth discovery against every URL
  row, which Settings' poll would do every 1.5s.
  `apps/cli/src/server/connectors/vendor-mcp-config.ts`,
  `connectors-service.ts`.

- **AGENT MEMORY IS REMOVED**. Claude Code and Codex carry their own; a third
  beside them is two answers to one question. The pattern stays: content the
  agent consumes lives in files it reads with its own shell. The dialect skills
  ride `INTELIGIR_SKILLS_DIR` with a three-sentence pointer on the first turn,
  never the spec inlined.

- **ONE SET OF SESSION FACTS, TWO PROJECTIONS, AND A LOADED SESSION IS HANDED
  ONLY THE INSTRUCTIONS IT DOES NOT HOLD.** The shell env and the prompt are
  pure functions of one set of facts, and the env is read at every spawn,
  because read once `INTELIGIR_CONNECTED_DIRS` freezes at the first turn. ACP's
  `session/new` carries no instructions, so they ride a turn's prompt, and a
  loaded session gets them again only when they differ from the last set its
  thread was handed. Claude's `_meta.systemPrompt` is not used: it is one
  harness's channel. `apps/cli/src/server/agents/agent-shell-env.ts`,
  `runtime-manager.ts`.

- **THE HOST CLOSES A PROVIDER SESSION IT GIVES UP ON, AND A CHILD'S DEATH FAILS
  ITS TURN THROUGH THE PROMPT.** The watchdog and a failed dispatch close the
  session first, so the next send resumes on a fresh child rather than a session
  holding the abandoned prompt. The child's exit closes the ACP connection with
  its status and last stderr lines, so every pending request rejects and a crash
  fails like a refused prompt. Rejected: an exit callback beside it, and
  per-thread exit generations, which fit a process shared by threads and would
  be a second answer to "did this turn fail?". A CLOSE counts, though: an open
  that sees a close land meanwhile throws rather than spawn an orphan.
  `packages/agent-runtime/src/acp/acp-runtime.ts`,
  `apps/cli/src/server/agents/runtime-manager.ts`.

- **A TIMELINE DELTA MOVES A HELD TURN AS A PATCH, AND A ROW CARRIES WHAT THE
  PANEL DRAWS.** Upserting a turn whole resends every command, tool call and
  thought for one streamed token, so a held turn travels as its status and only
  the children past the base, and a row whose text only grew travels as an
  append, since resending it whole costs bytes quadratic in its tokens. A turn
  row's position names its own contributors, not every turn-scoped event: a
  streaming assistant message lands as a top-level row, and counting it would
  move the turn row on every token. A command row carries its first lines; the
  event log keeps every byte. Residual: a tool row's result still rides whole.
  `packages/contract/src/local/thread-timeline.ts`,
  `apps/cli/src/server/threads/build-thread-timeline.ts`.

- **A THREAD IS NAMED BY ITS FIRST MESSAGE, ON THE SERVER**, in the transaction
  that appends it, local or synced; an explicit title stays. Naming it in the
  desktop left every action the CLI, an agent or another device started as
  "Untitled action". The rule is `deriveThreadTitle`
  (`@repo/domain/thread-title`), which the phone runs too, and a title the log
  states outranks it on every device.
  `apps/cli/src/server/threads/thread-ingest.ts`.

- **A STOP IS A CANCEL WITH A CLOSE BEHIND IT, AND THE TURN STILL ENDS THROUGH
  ITS OWN PROMPT** (owner decision: an agent writing the vault the wrong way
  needs a brake; deleting the unreachable `stopping` state was the rejected
  alternative). The turn settles through its prompt's `cancelled` end like any
  turn; one silent past the grace has its session closed and is settled by the
  host. Archiving a running thread stops it. A turn another device runs is
  refused: only its own process can reach its provider, so the panel draws no
  Stop there. `apps/cli/src/server/threads/thread-stop.ts`,
  `apps/cli/src/server/agents/runtime-manager.ts`.

- **AN ACTION'S ORIGIN IS ITS NOTE'S ID, and the path is only the fallback.**
  Rebinding the stored path on the rename route was rejected: Finder, an agent's
  `mv` and a pull never reach that route. The create stores the note's `id`
  beside the path, minting one through the annotation store's guarded step. A
  phone's request reads the id and never mints one, so over a note with none its
  thread is bound by path alone, and a boot binds each such path to its note's
  id once the note has one. A read prefers the stored path while it still
  carries the id, so a byte copy never takes the binding. The composer mints the
  open note's id through the live editor, because a server mint under the buffer
  would make the revision name bytes no longer on disk, and outside the undo
  history, because an undo would unbind the action just sent.
  `apps/cli/src/server/threads/thread-origins.ts`,
  `apps/workspace/src/app/note/open-note-id.ts`.

- **THE THREAD LIST IS A KEYSET PAGE, AND A QUESTION A PAGE CANNOT ANSWER IS
  ASKED OF THE SERVER.** A page is a run of threads after an opaque cursor, live
  before archived and newest first. An offset was rejected because a thread
  touched between two reads would shift every row behind it. A page is a window,
  so what must be whole is its own query: the open note's actions, the rail's
  agent spinner and the palette's Actions search. `packages/db/src/threads.ts`,
  `apps/workspace/src/app/actions/thread-hooks.ts`.

- **AN AGENT IS READY WHEN ITS VENDOR SAYS SO, THROUGH THE BUNDLED BINARY, OVER
  THE SHARED STORE, AND PATH IS NEVER CONSULTED**. Both runtimes ship inside the
  app, so a user with no vendor CLI installed is not an agent-less user: a
  harness runs the override its adapter honours, else the binary bundled beside
  the adapter, never PATH's. Signed-in is the vendor's own status command, read
  over `~/.claude` and `~/.codex`, so a Mac already signed in stays signed in; a
  file or keychain entry existing says nothing about whether the vendor still
  accepts it. Every vendor run goes through one spawn policy, with the data dir
  as cwd since a vendor reads project config from its cwd. A send is refused up
  front only when the thread's runtime is missing from the install, or its
  harness is one this build does not ship; a thread's row and log keep the
  harness open, since another device's newer build may name one. A signed-out
  vendor is not pre-gated, because the adapter's `authRequired` is the refusal
  and it names the vendor. `apps/cli/src/server/agents/vendor-process.ts`,
  `packages/agent-runtime/src/acp/harness-registry.ts`.

- **UNDO IS A THREE-WAY REVERT OF ONE TURN'S COMMIT, THROUGH THE VAULT'S OWN
  CAS.** Each path the turn changed is merged out of the bytes on disk now
  (`@repo/notes/text/revert-edit`), so an edit made since survives. A note whose
  later edits overlap or touch the turn's is kept whole and named, never half
  undone (owner decision); no Redo, since History restores. Rejected: `git
  revert` or `git checkout`, which bypass the CAS, the re-index, the `/ws`
  notification and the open buffer's convergence, and a byte restore to the
  parent, which discards every later edit, the user's included — the loss undo
  exists to remove. Every write is the vault's own guard, so there is no second
  CAS and a write racing the undo is kept and named. A path a running turn
  claimed is `busy`, and a turn still running or already undone is refused. The
  undo commits as the engine, never as the agent's turn, so an agent undoing an
  earlier turn from inside a later one does not commit the undo as its own. AN
  ANNOTATION STORE IS TAKEN BACK ENTRY BY ENTRY, never as lines, which can break
  its json: an entry goes or comes back only while it is as the turn left it. A
  FILE THAT IS NOT A DOC IS PUT BACK BYTE FOR BYTE, never merged, since an
  image or a PDF holds no lines and a merge of an svg's writes bytes nobody
  made: it goes back only while it holds exactly what the turn left, and is
  kept and named otherwise. It
  is wired beside the thread service rather than inside it, which would hand
  that service the vault's git and writes.
  `apps/cli/src/server/threads/turn-undo.ts`.

- **SIGNING AN AGENT IN IS THE METHOD ITS ADAPTER ADVERTISES, RUN BY THIS
  SERVER, ONE AT A TIME, AND A SIGNED-OUT AGENT IS ANSWERED BY ITS SIGN-IN, NOT
  BY A REFUSED SEND.** Claude's method is one the client runs, so the server
  runs the bundled claude's own login, piped (the header of `agent-sign-in.ts`
  says why no pty), and the code its page shows reaches the login's stdin, so a
  sign-in whose browser never opened still finishes; codex's adapter is started
  for the sign-in alone and asked to authenticate. A login counts only once the
  vendor's own status says signed in. One sign-in per server, because two
  browser logins would race for one callback, and a refused one is a failed
  outcome, never a refusal. The agent just signed in takes the default only from
  one a new thread could not run on, so a second sign-in never moves the user
  off the agent they use. Rejected: a pty (a native dependency, or `script`),
  which the login does not need; an API-key method, since there is no API-key
  fallback; and claude through the adapter's `--cli`, a node process in front of
  the same binary. `apps/cli/src/server/agents/agent-sign-in.ts`,
  `packages/agent-runtime/src/acp/acp-sign-in.ts`.

- **A SIGNED-OUT AGENT'S SIGN-IN STANDS WHERE THE FIELD WOULD BE, AND IS ONE
  SURFACE.** A default agent its vendor calls signed out puts the sign-in in
  ⌘K's place, keeping what was typed, and a signed-out thread no other device
  runs carries it above the reply; ⌘K draws nothing until the vendors have
  answered, because a field drawn first would be swapped for the sign-in under
  the typing. Each of those, each Settings card and onboarding draw the same
  component, whose Sign out names the vendor's own app it signs out too, since
  the store is shared. `apps/workspace/src/app/agents/agent-sign-in.tsx`.

- **A TURN THE VENDOR REFUSED FOR THE PLAN'S USAGE LIMIT OR A SIGN-IN LEAVES THE
  QUEUE WHERE IT IS.** A refused prompt, a refused session open and an adapter
  that died are each read once, into a class beside the adapter's own words,
  from what the adapter attaches. A codex turn fails by the typed session
  failure its prompt's answer carries, because the runtime declares typed
  failures for codex alone: undeclared, codex speaks every failure but a usage
  limit or a sign-in as the agent's text and ends the turn, so an overflowed
  context read as a finished reply; declared, claude would stop rejecting a
  limited turn with the `errorKind` the reader reads. An authentication failure
  reads as signed out whatever its code, so the panel says so rather than the
  adapter's text. A settle whose turn failed for the limit or a sign-in does not
  drain: the next send starts the oldest queued message first. The words a
  person reads of either are the host's, written beside that rule because they
  promise it; the runtime carries the adapter's words alone. Rejected: draining
  as for any failure, which spends every queued message on the same refusal and
  leaves nothing for after the limit resets or the sign-in.
  `packages/agent-runtime/src/acp/provider-error.ts`,
  `apps/cli/src/server/threads/thread-ingest.ts`, `provider-failure.ts`.

- **AN APPROVAL'S ANSWER IS ITS DECISION, AN ENUM ON THE WIRE AND IN THE ROW**,
  set exactly when the row is resolved, so a word the grammar does not name is
  the wire's 400. What the wire cannot know, whether the request offered that
  decision, is one check the route's gate and the waiter both run. Every json
  column is parsed inside `@repo/db` and handed back typed, null for bytes the
  grammar refuses, so one bad row costs that row. Rejected: a string the row
  replayed verbatim, re-parsed at four sites in two spellings, when its only
  field is the decision and the phone's answer already wrote the bare enum.
  `packages/db/src/pending-interactions.ts`,
  `packages/domain/src/pending-interactions.ts`.
