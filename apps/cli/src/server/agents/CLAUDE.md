# Decisions: agents and threads

Turns, threads, the agent's commits and undo, sign-in, connectors and annotations.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Agents and threads

- **Ingest is ONE transaction.** Append, lifecycle projection and queue touch
  run in one immediate transaction, and notifications flush after commit.
  Lifecycle CAS predicates carry the turn identity, so a late completion for
  turn A cannot settle turn B. Only `ThreadService` opens a transaction,
  flushing and dispatching after commit, since a scripted driver re-enters
  ingest and a transaction cannot nest.
  `apps/cli/src/server/threads/thread-ingest.ts`, `service.ts`.

- **AN AGENT COMMIT STAGES THE TURN'S OWN WRITE SET, AND A TURN IS FOUND BY ITS
  TRAILERS, NEVER BY ITS SHA.** The set is the edits that landed, not a failed
  or declined one (Undo would take the user's typing), plus the agent's
  `inteligir` vault writes, under a commit hold deferring the vault debounce and
  blocking a sync. The CLI names its thread on every agent call, as attribution,
  not authority; the thread and turn trailers are spelled once. Undo covers
  reported edits alone (owner decision). Rejected: committing the whole dirty
  tree (a concurrent turn's writes go to whoever settles first); a sha (a rebase
  rewrites it). Residual: a thread pulled from another device lists only the
  commits made after it arrived. `apps/cli/src/server/agents/agent-commits.ts`,
  `apps/cli/src/server/vault/turn-trailers.ts`.

- **A TURN OPENS WITH A CHECKPOINT OF THE UNCLAIMED DIRTY TREE**, since Undo
  needs the bytes from just before the turn: the note the user was typing in
  lands as the engine's, never inside the turn. Residuals: lines typed into a
  note while the agent edits it belong to the turn (the canonicalizing save-back
  allows no per-writer split); a crash mid-turn leaves its writes to the boot
  sweep, so that turn cannot be undone.
  `apps/cli/src/server/agents/agent-commits.ts`.

- **A SCRIPTED TURN'S `save` LINE SAVES INSIDE THE TURN.** Each `save <target>`
  line of its text runs through the items service and joins the turn's set,
  cover and original included, because the scripted driver hears no external
  shell's writes; it is how an e2e proves an agent's save leaves with its Undo.
  `apps/cli/src/server/agents/scripted-driver.ts`.

- **AN ANNOTATION STORE IS ONE DOT-FOLDER KEYED BY THE ITEM'S ID, ITS WRITE IS A
  CAS, AND EVERY ENTRY CARRIES ITS AUTHOR'S `source`; the cloud was rejected for
  it.** The frontmatter `id` survives a move anywhere, and one commit carries a
  note's anchors and bodies. A note without one gets it by a guarded note write;
  a read writes nothing; a non-text `id` is refused, never overwritten. The
  annotation-id grammar is spelled once
  (`@repo/notes/annotations/store-schema`). A deleted note's store goes with it
  unless a byte copy still carries the id, for the server's and the phone's
  deletes alike (`@repo/notes/annotations/store-removal`), and a restore brings
  both back. Rejected: bodies in a cloud table (they drift from the anchors, and
  need an account). `apps/cli/src/server/annotations/annotations-service.ts`.

- **A HIGHLIGHT MADE AWAY FROM THE EDITOR IS PLACED BY ITS QUOTE** (the CLI, a
  browser's selection, an import, a fill). `add` with `place` writes the entry,
  then the markers, each under its own CAS, so a crash between reads as a
  missing highlight, never as markers no entry explains. A passage the text
  lacks is refused before any write, and a note that changed twice under the
  markers takes the entry back out. A quote the text no longer holds goes under
  `## Highlights` once its fill is final. Rejected: an anchor of offsets beside
  the text (every edit moves it), a fuzzy match (two Macs would pick two
  passages). `packages/notes/src/annotations/place-quotes.ts`,
  `apps/cli/src/server/annotations/annotations-service.ts`.

- **A HIGHLIGHT'S MARKERS ARE ONLY SPLICED INTO THE BYTES**, so taking them out
  gives the input back and two Macs placing one quote write the same bytes; an
  edge never splits what the editor reads as one piece.
  `packages/notes/src/annotations/place-quotes.ts`.

- **REMOVING A HIGHLIGHT TAKES ITS ENTRY FIRST AND ITS MARKERS SECOND.**
  `remove` with `stripMarkers` keeps another id on a shared pair. The window's
  Remove highlight asks for it whenever no open editor holds the item (a saved
  page shown as its copy); otherwise the editor takes the markers out under its
  own save. `apps/cli/src/server/annotations/annotations-service.ts`,
  `apps/workspace/src/app/actions/annotations-tab.tsx`.

- **A BYTE COPY IS RE-KEYED AND ITS STORE FORKED, never stripped of its id.**
  The store is copied under the new id first, then the copy's `id:` line moves
  under the CAS, so both notes keep every annotation and the one keeping the old
  id keeps its `[[Title|uuid]]` links and actions. Rejected: deleting the copy's
  `id:` line (its anchors' bodies live only under that id).
  `@repo/contract/local/vault/give-note-own-id`.

- **A VIEW CONTEXT RIDES THE MESSAGE, and it is a statement about the past.**
  What the user was looking at travels on the send
  (`@repo/domain/view-context`), so navigating away mid-turn changes nothing:
  the open item (`doc`), or the library (`library`): the grid's scope, kinds and
  search, and the selection's count and up to 200 paths, the prompt's "these". A
  queued send carries none. The thread event drops the library context's paths,
  which only the prompt reads, since an event lives as long as its thread
  (`apps/cli/src/server/threads/thread-send.ts`). Rejected: a thread column or a
  server-side "current view" (nothing owns it); a tool (the agent reads the
  file, and a live selection cannot be made honest).
  `apps/cli/src/server/agents/view-context-prompt.ts`.

- **AN @-MENTION RIDES THE SEND AS `contextPaths`, NEVER AS TEXT.** The stored
  message is exactly what was typed, so the timeline, the phone and a thread's
  title read no prefix the desktop glued on; the server names the notes in a
  block of its own. A queued send KEEPS them, unlike a view context: a mention
  is part of what the user asked. A mention names an item; the grid's selection
  is a view context, a statement about the screen.
  `@repo/contract/local/threads/threads-schema`.

- **A NAMED ACTION IS A PRESET ON THE SEND, NOT A PROMPT IN THE TEXT.** Tidy my
  library is `preset: "tidy-library"`: the stored text is what was typed, or the
  preset's label when nothing was, and the server composes the procedure as its
  own block, worded for what the session holds (file and tag what is in Unsorted
  or untagged, in batches of 100). The preset survives the queue in its own
  column, never in the thread event. Rejected: a seeded composer prompt (the
  person's words would be ours, and the timeline and phone would show
  instructions); a `library.tidy` procedure (a second agent entry); an agent run
  per save (it spends the person's plan on every bookmark).
  `apps/cli/src/server/agents/action-preset-prompt.ts`.

- **THE DEFAULT HARNESS IS A STORED CHOICE, read per thread start**, in the data
  dir, not config.json, which is read once at boot and written by the app only
  for its vault selector.
  Unset, it is claude whatever PATH holds, since both runtimes ship in the app.
  A thread keeps the harness it started on, and a model is per harness, since a
  model id is vendor-specific. The read strips a config.json key it does not
  name rather than refusing it: the window edits nothing there but that
  selector, so a refusal is a boot nothing in the app repairs.
  `apps/cli/src/server/agents/agent-prefs-store.ts`,
  `apps/cli/src/server/config.ts`.

- **CONNECTORS ARE THE DEFAULT AGENT'S OWN MCP CONFIG**: one registry, the
  vendor's, with the vendor's own sign-in. Settings edits the default agent's
  user-level servers through its bundled binary, so a change of agent moves the
  section and every vault shares the list. Add and remove only: no toggle, no
  header field (Codex keeps no static header). A session is handed no servers of
  the app's, so it loads the config Settings edits. A plain list answers from
  the last read for ten seconds, since reading codex's spawns it and runs OAuth
  discovery against every URL row, which Settings' poll repeats every 1.5s.
  Rejected: an app-owned registry with hand-built OAuth.
  `apps/cli/src/server/connectors/vendor-mcp-config.ts`,
  `connectors-service.ts`.

- **AGENT MEMORY IS REMOVED**. Claude Code and Codex carry their own, and a
  third beside them is two answers to one question. Content the agent consumes
  lives in files it reads with its own shell: the dialect skills ride
  `INTELIGIR_SKILLS_DIR` behind a three-sentence pointer on the first turn,
  never the spec inlined. The library's own AGENTS.md is the person's filing
  rules: it closes the instructions under a header that says so, and the Tidy
  block follows it when it is there.

- **ONE SET OF SESSION FACTS, TWO PROJECTIONS, AND A LOADED SESSION IS HANDED
  ONLY THE INSTRUCTIONS IT DOES NOT HOLD.** The shell env and the prompt are
  pure functions of one set of facts, the env read at every spawn so
  `INTELIGIR_CONNECTED_DIRS` never freezes at the first turn. ACP's
  `session/new` carries no instructions, so they ride a turn's prompt, again
  only when they differ from the last set the thread was handed. The prompt's
  blocks read `PromptFacts`
  (`apps/cli/src/server/agents/agent-instructions.ts`): `inteligir` commands
  only when `cliBinDir` resolved, every library or typed value one sh word
  (`apps/cli/src/shell-quote.ts`) since the agent runs it as written, and the
  Tidy block's filing rules only when the library has them. Rejected: Claude's
  `_meta.systemPrompt` (one harness's channel).
  `apps/cli/src/server/agents/agent-shell-env.ts`, `runtime-manager.ts`.

- **THE HOST CLOSES A PROVIDER SESSION IT GIVES UP ON, AND A CHILD'S DEATH FAILS
  ITS TURN THROUGH THE PROMPT.** The watchdog and a failed dispatch close the
  session first, so the next send resumes on a fresh child. The child's exit
  closes the ACP connection with its status and last stderr lines, so every
  pending request rejects and a crash fails like a refused prompt. An open that
  sees a close land meanwhile throws rather than spawn an orphan. Rejected: an
  exit callback beside it, and per-thread exit generations (they fit a process
  shared by threads, and answer "did this turn fail?" twice).
  `packages/agent-runtime/src/acp/acp-runtime.ts`,
  `apps/cli/src/server/agents/runtime-manager.ts`.

- **A TIMELINE DELTA MOVES A HELD TURN AS A PATCH, AND A ROW CARRIES WHAT THE
  PANEL DRAWS.** A held turn travels as its status and the children past the
  base, and a row whose text only grew as an append. A turn row's position names
  its own contributors, not every turn-scoped event: a streaming assistant
  message is a top-level row, and counting it would move the turn row every
  token. A command row carries its first lines; the event log keeps every byte.
  Rejected: upserting a turn whole (every command, tool call and thought per
  token) or a grown row whole (bytes quadratic in its tokens). Residual: a tool
  row's result rides whole. `packages/contract/src/local/thread-timeline.ts`,
  `apps/cli/src/server/threads/build-thread-timeline.ts`.

- **A THREAD IS NAMED BY ITS FIRST MESSAGE, ON THE SERVER**, in the transaction
  that appends it, local or synced; an explicit title stays. The rule is
  `deriveThreadTitle` (`@repo/domain/thread-title`), which the phone runs too,
  and a title the log states outranks it on every device. Rejected: naming it in
  the desktop (every action the CLI, an agent or another device started stayed
  "Untitled action"). `apps/cli/src/server/threads/thread-ingest.ts`.

- **A STOP IS A CANCEL WITH A CLOSE BEHIND IT, AND THE TURN STILL ENDS THROUGH
  ITS OWN PROMPT** (owner decision: an agent writing the vault the wrong way
  needs a brake). The turn settles through its prompt's `cancelled` end; one
  silent past the grace has its session closed and is settled by the host.
  Archiving a running thread stops it. A turn another device runs is refused,
  since only its own process reaches its provider, so the panel draws no Stop
  there. Rejected: deleting the unreachable `stopping` state.
  `apps/cli/src/server/threads/thread-stop.ts`,
  `apps/cli/src/server/agents/runtime-manager.ts`.

- **AN ACTION'S ORIGIN IS ITS NOTE'S ID, and the path is only the fallback.**
  The create stores the note's `id` beside the path, minted through the
  annotation store's guarded step. A phone's request never mints: over a note
  with no id the thread binds by path, and a boot binds it to the id once the
  note has one. A read prefers the stored path while it still carries the id, so
  a byte copy never takes the binding. An action sent from the library has no
  origin doc: its subject is that view. Rejected: rebinding the stored path on
  the rename route (Finder, an agent's `mv` and a pull never reach it).
  `apps/cli/src/server/threads/thread-origins.ts`.

- **THE THREAD LIST IS A KEYSET PAGE, AND A QUESTION A PAGE CANNOT ANSWER IS
  ASKED OF THE SERVER.** A page is a run of threads after an opaque cursor, live
  before archived and newest first. What must be whole is its own query: the
  open note's actions, the rail's agent spinner and the palette's Actions
  search. Rejected: an offset (a thread touched between two reads shifts every
  row behind it). `packages/db/src/threads.ts`,
  `apps/workspace/src/app/actions/thread-hooks.ts`.

- **AN AGENT IS READY WHEN ITS VENDOR SAYS SO, THROUGH THE BUNDLED BINARY, OVER
  THE SHARED STORE, AND PATH IS NEVER CONSULTED**. Both runtimes ship inside the
  app, so a harness runs the override its adapter honours, else the binary
  bundled beside the adapter. Signed-in is the vendor's own status command over
  `~/.claude` and `~/.codex`, so a Mac already signed in stays signed in. Every
  vendor run goes through one spawn policy, cwd the data dir, since a vendor
  reads project config from its cwd. Rejected: a file or keychain entry as
  sign-in (it says nothing of whether the vendor still accepts it).
  `apps/cli/src/server/agents/vendor-process.ts`,
  `packages/agent-runtime/src/acp/harness-registry.ts`.

- **A SEND IS REFUSED UP FRONT ONLY FOR A HARNESS THIS INSTALL CANNOT RUN**: the
  thread's runtime is missing from the install, or its harness is one this build
  does not ship. A thread's row and log keep the harness open, since another
  device's newer build may name one. Rejected: pre-gating a signed-out vendor
  (the adapter's `authRequired` is the refusal, and it names the vendor).
  `apps/cli/src/server/agents/vendor-process.ts`.

- **UNDO IS A THREE-WAY REVERT OF ONE TURN'S COMMIT, THROUGH THE VAULT'S OWN
  CAS.** Each path the turn changed is merged out of the bytes on disk now
  (`@repo/notes/text/revert-edit`), so a later edit survives; a note whose later
  edits overlap or touch the turn's is kept whole and named, never half undone
  (owner decision). No Redo: History restores. Every write is the vault's own
  guard, so a write racing the undo is kept and named. Rejected: `git revert` or
  `git checkout` (they bypass the CAS, the re-index, the `/ws` notification and
  the open buffer's convergence); a byte restore to the parent (it discards
  every later edit, the user's included).
  `apps/cli/src/server/threads/turn-undo.ts`.

- **AN UNDO COMMITS AS THE ENGINE, NEVER AS THE AGENT'S TURN**, so an agent
  undoing an earlier turn from inside a later one does not commit the undo as
  its own. A path a running turn claimed is `busy`, and a turn still running or
  already undone is refused. Undo is wired beside the thread service, not inside
  it, which would hand that service the vault's git and writes.
  `apps/cli/src/server/threads/turn-undo.ts`.

- **IN AN UNDO, AN ANNOTATION STORE IS TAKEN BACK ENTRY BY ENTRY**, never as
  lines, which can break its json: an entry goes or comes back only while it is
  as the turn left it. `apps/cli/src/server/threads/turn-undo.ts`.

- **IN AN UNDO, A FILE THAT IS NOT A DOC IS PUT BACK BYTE FOR BYTE**, never
  merged, since an image or a PDF holds no lines and a merged svg is bytes
  nobody made. It goes back only while it holds exactly what the turn left, and
  is kept and named otherwise. One the turn added stays while a doc the undo did
  not take back links or embeds it (`linked-since`), since a cover is shared by
  its hash and a later item may embed that very file; so the files go after the
  notes, as the delete asks of `attachmentsFreedBy`.
  `apps/cli/src/server/threads/turn-undo.ts`.

- **SIGNING AN AGENT IN IS THE METHOD ITS ADAPTER ADVERTISES, RUN BY THIS
  SERVER, ONE AT A TIME, AND A SIGNED-OUT AGENT IS ANSWERED BY ITS SIGN-IN, NOT
  BY A REFUSED SEND.** Claude's method is client-run, so this server runs the
  bundled claude's login, piped, feeding it the code its page shows, so a
  sign-in whose browser never opened finishes; codex's adapter starts for the
  sign-in alone. It counts once the vendor's status agrees. Two would race for
  one browser callback, so a refused one is a failed outcome, never a refusal.
  Rejected: a pty (a native dependency, or `script`); an API-key method (there
  is no API-key fallback); claude through the adapter's `--cli` (a node process
  before the same binary). `apps/cli/src/server/agents/agent-sign-in.ts`,
  `packages/agent-runtime/src/acp/acp-sign-in.ts`.

- **A SIGN-IN MOVES THE DEFAULT AGENT ONLY OFF ONE A NEW THREAD COULD NOT RUN
  ON**, so a second sign-in never moves the user off the agent they use.
  `adoptDefault` in `apps/cli/src/server/agents/agents-service.ts`.

- **A SIGNED-OUT AGENT'S SIGN-IN STANDS WHERE THE FIELD WOULD BE, AND IS ONE
  SURFACE.** A signed-out default agent puts the sign-in in ⌘K's place, keeping
  what was typed, and a signed-out thread no other device runs carries it above
  the reply; ⌘K draws nothing until the vendors answer, or the sign-in would
  replace a field under the typing. Those, each Settings card and onboarding
  draw one component, whose Sign out names the vendor's own app it signs out
  too, since the store is shared.
  `apps/workspace/src/app/agents/agent-sign-in.tsx`.

- **A TURN THE VENDOR REFUSED FOR THE PLAN'S USAGE LIMIT OR A SIGN-IN LEAVES THE
  QUEUE WHERE IT IS.** Its settle does not drain: the next send starts the
  oldest queued message first. A refused prompt, a refused session open and a
  dead adapter are each read once, into a class beside the adapter's words, from
  what the adapter attaches; an authentication failure reads as signed out
  whatever its code, and the panel says so. The words a person reads are the
  host's, beside the rule they promise; the runtime carries the adapter's alone.
  Rejected: draining as for any failure (every queued message spent on the same
  refusal). `packages/agent-runtime/src/acp/provider-error.ts`,
  `apps/cli/src/server/threads/thread-ingest.ts`, `provider-failure.ts`.

- **A CODEX TURN FAILS BY THE TYPED SESSION FAILURE ITS PROMPT'S ANSWER
  CARRIES**, since the runtime declares typed failures for codex alone (the
  harness row's `typedFailures`). Undeclared, codex speaks every failure but a
  usage limit or a sign-in as the agent's text and ends the turn, so an
  overflowed context read as a finished reply; declared, claude would stop
  rejecting a limited turn with the `errorKind` the reader reads.
  `packages/agent-runtime/src/acp/harness-registry.ts`.

- **AN APPROVAL'S ANSWER IS ITS DECISION, AN ENUM ON THE WIRE AND IN THE ROW**,
  set exactly when the row is resolved, so a word the grammar does not name is
  the wire's 400. Whether the request offered that decision is one check the
  route's gate and the waiter both run. Every json column is parsed inside
  `@repo/db` and handed back typed, null for bytes the grammar refuses, so one
  bad row costs that row. Rejected: a string the row replayed verbatim
  (re-parsed at four sites in two spellings, when its only field is the decision
  and the phone already wrote the bare enum).
  `packages/db/src/pending-interactions.ts`,
  `packages/domain/src/pending-interactions.ts`.
