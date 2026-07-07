// ---------------------------------------------------------------------------
// In-memory fixture Bridge for the browser dev harness. Fully typed against
// the real Bridge contract — when the IPC registry changes, this file fails
// typecheck. Vault reads/writes hit a Map seeded with sample notes; agent
// chat streams a canned reply; STT streams a canned transcript;
// TTS/executor/updates report unavailable.
// ---------------------------------------------------------------------------

import type { AppAgentEvent } from "@repo/features/agent-events";
import type { AppState } from "@repo/features/app-state";
import type { Delegation, ListDelegationsResult } from "@repo/features/delegation";
import { GHOST_TEXT_ENABLED_UI_STATE, type AiIntent } from "@repo/features/inline-ai";
import type { Bridge, ChatHistoryEntry, UpdateState } from "@repo/features/ipc";
import type { VaultEntry } from "@repo/features/ipc-registry";
import type { SyncState } from "@repo/features/sync";
import { isDocPath } from "@repo/core/knowledge/doc-file";
import { KnowledgeIndex } from "@repo/core/knowledge/knowledge-index";
import { computeRenameEdits } from "@repo/core/knowledge/rename-links";

// Single source with the round-trip fixture matrix: the full-vocabulary sample
// note IS the canonical kitchen-sink fixture.
import kitchenSink from "../src/renderer/__tests__/fixtures/roundtrip/canonical/kitchen-sink.md?raw";

const FIXTURE_ROOT = "/fixture-vault";

// Exported for the legacy-corpus classification test: every sample note must
// hold its expected canonical/raw class as the pipeline evolves.
export const SAMPLE_NOTES: Record<string, string> = {
  // Sample notes are PRE-CANONICALIZED (pinned by the corpus test): a churn-y
  // note would reflow wholesale on its first edit, drowning the user's change
  // in formatting noise. Long paragraphs stay on one line (the alternative
  // canonical form is `\`-terminated hard-break lines).
  // empty.md exercises the pristine-editor placeholder path — the one state
  // every other (non-empty) sample note can't reach.
  "empty.md": "",
  "welcome.md": `# Welcome

This is the **inteligir** dev harness — a plain-browser run of the portable app against an in-memory vault. Edits persist until you reload the page.

- Open a note from the sidebar
- Try the editor: headings, lists, tables, code
- The chat composer streams a canned reply

Read more in [tasks](tasks.md).
`,
  "tasks.md": `# Tasks

## Today

- [ ] Review the replatform plan
- [x] Extract the renderer into packages/app
- [ ] Boot the dev harness in a browser

## Later

- [ ] Port the editor to the Potion kits
- [ ] Wire the WebSocket bridge
`,
  "notes/roadmap.md": `# Roadmap

| Phase | Package         | Status |
| ----- | --------------- | ------ |
| 1     | packages/core   | merged |
| 2     | packages/app    | active |
| 3     | packages/host   | queued |
| 4     | packages/server | queued |
`,
  "notes/snippets.md": `# Snippets

A code block to exercise syntax highlighting:

\`\`\`ts
export function greet(name: string): string {
  return \`hello, \${name}\`;
}
\`\`\`

Inline \`code\` and a blockquote:

> Bytes on disk stay canonical.
`,
  "journal.md": `# Journal

## 2026-07-01

Started the harness. _Everything_ renders without Electron.

1. First ordered item
2. Second ordered item
`,
  // WP1 pipeline notes — drive the Rich/Raw gate end-to-end in the harness.
  "kitchen-sink.md": kitchenSink,
  "legacy-web-clip.md": `# Clipped page

<!-- saved from a browser -->

<div align="center">Centered legacy HTML</div>

See <https://example.com/original> for the source. Load {unmatched

Latency is <50ms on a good day.
`,
  "frontmatter-note.md": `---
title: Frontmatter note
tags: [meta, demo]
---

# Frontmatter note

The yaml block above survives Rich edits byte-for-byte; edit it via Raw.
`,
  // WP2 vocabulary notes — every kit exercisable in the harness. All four are
  // CANONICAL (the corpus test pins that): editing them must never flip the
  // pane to Raw.
  "components-playground.md": `# Components playground

One of each vocabulary block, exercisable in the harness.

<toggle>
  Toggle summary line.

  Toggle body with a [[wiki link]] and **bold**.

  - nested bullet
  - another
</toggle>

<toggle />

<column_group>
  <column>
    Left column text.
  </column>

  <column>
    Right column text.
  </column>
</column_group>

<column_group>
  <column width="33.33%">
    one
  </column>

  <column width="33.33%">
    two
  </column>

  <column width="33.34%">
    three
  </column>
</column_group>

Due <date value="2026-07-04" /> and reviewed on <date value="2026-07-01" />.

<video src="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />

<video src="https://vimeo.com/76979871" />

<media_embed src="https://twitter.com/jack/status/20" />

<file src="https://pdfobject.com/pdf/sample.pdf" />

<callout variant="info">
  A compat callout with **bold** body text.
</callout>

> [!TIP]
> Product callouts stay GitHub-alert blockquotes.

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

Inline math $$E = mc^2$$ mid-sentence, and an emoji trigger to try: type a colon.
`,
  "math-and-diagrams.md": `# Math and diagrams

Display math with a multi-line matrix:

$$
\\begin{pmatrix}
a & b \\\\
c & d
\\end{pmatrix}
$$

Inline $$m$$ in a table:

| name | value   |
| ---- | ------- |
| mass | $$m$$   |
| c    | $$3e8$$ |

\`\`\`mermaid
graph TD;
A[Start] --> B{Decide};
B -->|yes| C[Ship];
B -->|no| D[Iterate];
\`\`\`

\`\`\`mermaid
sequenceDiagram
Alice->>Bob: Ship WP2?
Bob-->>Alice: Green gates first.
\`\`\`

A \`math\` fence stays a plain fence:

\`\`\`math
E = mc^2
\`\`\`
`,
  "wiki/hub.md": `# Hub

Links: [[target note]], aliased [[target note|the target]], an anchor [[target note#section]], and a missing [[missing note]].

Embed placeholder: ![[target note]]

- [ ] follow up on [[target note]]
`,
  "wiki/target note.md": `# Target note

## Section

The hub links here. Backlinks arrive in a later phase.

| feature | status |
| ------- | ------ |
| embeds  | live   |
| tables  | boxed  |
`,
  // Phase F knowledge notes — an interlinked cluster so tabs, chips,
  // backlinks, transclusion (incl. guards), graph, and search all demo well.
  "wiki/ideas.md": `# Ideas

Seeds worth growing, linked from the [[hub]].

- Build a [[target note|target]] deep-dive
- Cross-link with [[wiki/projects|projects]]
- Chase the [[missing note]] ghost

Embedded reference: ![[target note]]
`,
  "wiki/projects.md": `# Projects

Active work, paired with [[ideas]].

1. Ship the knowledge UI (see [[hub]])
2. Write the [[target note#Section|section notes]]
`,
  "wiki/digest.md": `# Digest

A transclusion sampler over the wiki cluster.

Full embed: ![[ideas]]

Missing embed: ![[missing note]]

Self embed (cycle guard): ![[digest]]
`,
};

// Matches one checkbox line: indent, marker, box state, label. Ordinals count
// every checkbox (checked or not), mirroring the host's find-task-line.
const CHECKBOX_RE = /^(\s*)- \[( |x|X)\] (.*)$/;

/** Simulate the background agent's edit: check the `index`-th checkbox off and
 * append a nested one-line result under it. Returns null when the ordinal
 * doesn't land on a checkbox. */
function simulateDelegationEdit(
  content: string,
  index: number,
): { content: string; taskText: string; lineText: string } | null {
  const lines = content.split("\n");
  let ordinal = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = CHECKBOX_RE.exec(line);
    if (!match) continue;
    ordinal++;
    if (ordinal !== index) continue;
    const [, indent = "", , label = ""] = match;
    lines[i] = `${indent}- [x] ${label}`;
    lines.splice(i + 1, 0, `${indent}  - ✅ Done in the dev harness (simulated edit)`);
    return { content: lines.join("\n"), taskText: label, lineText: line.trim() };
  }
  return null;
}

/** Streams `text` in small chunks via `onDelta`, then calls `onDone`.
 * `initialDelayMs` holds the pre-stream gap — the chat reply uses a longer
 * one so the composer's "thinking" treatment is visible in the harness. */
function streamText(
  text: string,
  onDelta: (delta: string) => void,
  onDone: () => void,
  initialDelayMs = 120,
): void {
  const words = text.split(/(?<= )/);
  let i = 0;
  const tick = () => {
    const chunk = words.slice(i, i + 3).join("");
    i += 3;
    onDelta(chunk);
    if (i < words.length) setTimeout(tick, 40);
    else onDone();
  };
  setTimeout(tick, initialDelayMs);
}

class Emitter<T> {
  private listeners = new Set<(event: T) => void>();

  subscribe = (listener: (event: T) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  emit(event: T): void {
    for (const listener of this.listeners) listener(event);
  }
}

const IDLE_UPDATE: UpdateState = {
  status: "idle",
  version: null,
  downloadPercent: null,
  message: null,
};

const unavailable = (feature: string) =>
  new Error(`${feature} is not available in the dev harness`);

// Canned STT transcript, streamed partial → partial → final (harness stub —
// no recognizer runs) so the composer's listening capsule is demoable in a
// plain browser tab.
const STT_CANNED_TRANSCRIPT = "What should I write about today?";

// ---------------------------------------------------------------------------
// Canned editor-AI behaviors, so the whole AI surface (menu intents, edit
// suggestions, ghost text) is drivable in the harness without a host.
// ---------------------------------------------------------------------------

// Keyword heuristic standing in for the host-side classifier.
const EDIT_INTENT_WORDS =
  /\b(rewrite|rephrase|fix|improve|shorten|shorter|longer|simplify|translate|edit|change|correct|polish|tighten)\b/i;

function cannedIntent(prompt: string): AiIntent {
  return EDIT_INTENT_WORDS.test(prompt) ? "edit" : "generate";
}

// The edit prompt embeds the target markdown between <markdown> sentinels
// (see ai-session.ts buildEditPrompt). The canned "edit" mutates it
// deterministically: word swaps produce inline insert+remove marks and the
// appended paragraph produces a block-insert suggestion.
function cannedEditResponse(prompt: string): string | null {
  const match = /<markdown>\n([\s\S]*?)\n<\/markdown>/.exec(prompt);
  const markdown = match?.[1];
  if (markdown === undefined) return null;
  const rewritten = markdown
    .replaceAll(/\bis\b/g, "was")
    .replaceAll(/\bthe\b/g, "that")
    .trimEnd();
  return `${rewritten}\n\nA canned closing thought from the dev harness.`;
}

// A non-doc vault file so attachment flows are exercisable in the harness:
// the `[[` picker's Attachments group, `![[diagram.png]]` resolution, and
// asset rename-rewrite. The Map is string-valued, so a placeholder stands in
// for the binary bytes — listVault classifies by extension, and the knowledge
// engine only ever needs the PATH of a non-doc file. Kept out of SAMPLE_NOTES:
// that record is the markdown-corpus test's contract (every entry must
// classify as a doc).
const SAMPLE_ASSETS: Record<string, string> = {
  "wiki/diagram.png": "png-placeholder (dev harness fixture, not real image bytes)",
};

export function createFixtureBridge(): Bridge {
  const vault = new Map<string, string>([
    ...Object.entries(SAMPLE_NOTES),
    ...Object.entries(SAMPLE_ASSETS),
  ]);
  // Ghost text defaults ON in the harness — there is no cost here and the
  // whole AI surface should be drivable out of the box.
  const uiState: Record<string, unknown> = { [GHOST_TEXT_ENABLED_UI_STATE]: true };
  const history: ChatHistoryEntry[] = [];
  const delegations: Delegation[] = [];
  // Pre-run copies keyed by delegation id — the in-memory twin of the host's
  // ~/.inteligir/snapshots store, so "Restore original" is exercisable.
  const snapshots = new Map<string, { path: string; content: string }>();
  let notifications = { enabled: false };
  let appState: AppState = { phase: "ready", agent: "idle" };
  // Sync — an in-memory stand-in so the settings Sync section is demoable
  // without a coordinator: sign-in always succeeds, syncNow returns a stub.
  let syncState: SyncState = {
    enabled: false,
    signedIn: false,
    email: null,
    coordinatorUrl: "",
    status: { phase: "idle" },
  };

  const agentEvents = new Emitter<AppAgentEvent>();
  const appStateEvents = new Emitter<AppState>();
  const sttEvents = new Emitter<{ text: string; isFinal: boolean }>();
  let sttTimers: ReturnType<typeof setTimeout>[] = [];
  let sttFinalPending = false;
  const vaultEvents = new Emitter<{ root: string }>();
  const aiEvents = new Emitter<{ requestId: string; delta: string }>();
  const delegationEvents = new Emitter<ListDelegationsResult>();
  const knowledgeEvents = new Emitter<{ revision: number }>();
  const syncEvents = new Emitter<SyncState>();
  const emitSync = () => syncEvents.emit(syncState);

  const setAppState = (next: AppState) => {
    appState = next;
    appStateEvents.emit(next);
  };

  const listEntries = (): VaultEntry[] =>
    [...vault.keys()].toSorted().map((path) => ({
      path,
      name: path.split("/").at(-1) ?? path,
      kind: isDocPath(path) ? "doc" : "other",
    }));

  // A REAL knowledge index over the in-memory vault — the same core engine
  // the host runs — so backlinks/graph/search/autocomplete are exercisable
  // in the harness with live data.
  const knowledge = new KnowledgeIndex();
  const indexEntry = (path: string): void => {
    const content = vault.get(path);
    if (content === undefined) return;
    if (isDocPath(path)) knowledge.setDoc(path, content);
    else knowledge.setOther(path);
  };
  for (const path of vault.keys()) indexEntry(path);
  let knowledgeRevision = 0;
  const touchVault = (): void => {
    vaultEvents.emit({ root: FIXTURE_ROOT });
    knowledgeRevision++;
    knowledgeEvents.emit({ revision: knowledgeRevision });
  };

  const cannedReply = (text: string) => {
    history.push({ role: "user", text });
    setAppState({ phase: "ready", agent: "busy" });
    agentEvents.emit({ type: "agent_start" });
    agentEvents.emit({ type: "message_start", role: "assistant" });
    const reply = `You said: “${text.trim()}”. This is the dev harness — no agent is running, but the composer, streaming, and history plumbing are all live.`;
    streamText(
      reply,
      (delta) => agentEvents.emit({ type: "message_update", delta }),
      () => {
        agentEvents.emit({ type: "message_end", role: "assistant", text: reply });
        agentEvents.emit({ type: "agent_end" });
        history.push({ role: "assistant", text: reply });
        setAppState({ phase: "ready", agent: "idle" });
      },
      // A beat of pre-stream silence so the busy-with-no-text "thinking"
      // treatment is observable before deltas arrive.
      1200,
    );
  };

  return {
    // Desktop / updates — nothing to update in a browser tab.
    checkForUpdates: async () => IDLE_UPDATE,
    downloadUpdate: async () => ({ accepted: false, state: IDLE_UPDATE }),
    installUpdate: async () => ({ accepted: false, state: IDLE_UPDATE }),
    onUpdateState: () => () => {},

    // App lifecycle
    getAppState: async () => appState,
    transition: async (event) => {
      switch (event.type) {
        case "LOGIN":
        case "SETUP":
        case "RETRY":
        case "NEW_SESSION":
          history.length = 0;
          setAppState({ phase: "ready", agent: "idle" });
          return;
        case "LOGOUT":
          setAppState({ phase: "logged_out" });
          return;
      }
    },
    onAppState: appStateEvents.subscribe,
    onSetupProgress: () => () => {},

    // Agent — canned streamed echo so the composer is testable.
    onAgentEvent: agentEvents.subscribe,
    sendAgentCommand: async (command) => {
      if (command.type === "interrupt") {
        agentEvents.emit({ type: "agent_end" });
        setAppState({ phase: "ready", agent: "idle" });
        return;
      }
      cannedReply(command.text);
    },
    getAgentHistory: async () => [...history],
    reauthenticate: async () => ({ ok: true }),

    // Voice — TTS reports unavailable; STT is SIMULATED: startStt arms timers
    // that stream a canned transcript so the listening capsule is demoable.
    isTtsAvailable: async () => false,
    ttsSend: () => {},
    ttsFlush: () => {},
    ttsInterrupt: () => {},
    onTtsAudio: () => () => {},
    startStt: async () => {
      for (const t of sttTimers) clearTimeout(t);
      sttFinalPending = true;
      const words = STT_CANNED_TRANSCRIPT.split(" ");
      sttTimers = [
        setTimeout(
          () => sttEvents.emit({ text: words.slice(0, 3).join(" "), isFinal: false }),
          900,
        ),
        setTimeout(
          () => sttEvents.emit({ text: words.slice(0, 5).join(" "), isFinal: false }),
          1800,
        ),
        setTimeout(() => {
          sttFinalPending = false;
          sttEvents.emit({ text: STT_CANNED_TRANSCRIPT, isFinal: true });
        }, 2700),
      ];
      return { ok: true };
    },
    sendSttAudio: () => {},
    stopStt: async () => {
      for (const t of sttTimers) clearTimeout(t);
      sttTimers = [];
      // Stopped mid-stream → the "recognizer" flushes the tail final once;
      // after the timed final already fired there is nothing left to return.
      if (!sttFinalPending) return [];
      sttFinalPending = false;
      return [{ text: STT_CANNED_TRANSCRIPT, isFinal: true }];
    },
    onSttTranscript: sttEvents.subscribe,
    getVoiceModelStatus: async () => "missing",
    downloadVoiceModel: async () => ({
      ok: false,
      error: "voice models are not available in the dev harness",
    }),
    onVoiceModelState: () => () => {},

    // Notifications
    getNotificationSettings: async () => notifications,
    updateNotificationSettings: async (patch) => {
      notifications = { enabled: patch.enabled ?? notifications.enabled };
      return notifications;
    },

    // UI state
    getUiState: async () => ({ ...uiState }),
    setUiState: async ({ key, value }) => {
      uiState[key] = value;
    },

    // Vault — an in-memory Map seeded with sample notes.
    getVaultRoot: async () => FIXTURE_ROOT,
    chooseVaultRoot: async () => ({ canceled: true }),
    listVault: async () => listEntries(),
    readVaultDoc: async ({ path }) => {
      const content = vault.get(path);
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return content;
    },
    writeVaultDoc: async ({ path, content }) => {
      vault.set(path, content);
      indexEntry(path);
      touchVault();
    },
    deleteVaultEntry: async ({ path }) => {
      const removed = vault.delete(path);
      if (removed) {
        knowledge.remove(path);
        touchVault();
      }
      return { removed };
    },
    renameVaultEntry: async ({ from, to }) => {
      const content = vault.get(from);
      if (content === undefined) return { ok: false, error: `no such file: ${from}` };
      if (vault.has(to)) return { ok: false, error: `already exists: ${to}` };
      // Mirror the host: rename, then rewrite every link that pointed at the
      // old path (same pure core edit computation).
      const docs = new Map<string, string>();
      for (const [path, text] of vault) {
        if (isDocPath(path)) docs.set(path, text);
      }
      const edits = computeRenameEdits(docs, vault.keys(), from, to);
      vault.delete(from);
      knowledge.remove(from);
      vault.set(to, content);
      for (const [path, text] of edits) vault.set(path, text);
      indexEntry(to);
      for (const path of edits.keys()) indexEntry(path);
      touchVault();
      return { ok: true };
    },
    onVaultChanged: vaultEvents.subscribe,

    // Knowledge — live queries against the in-memory index.
    getBacklinks: async ({ path }) => knowledge.backlinks(path),
    getForwardLinks: async ({ path }) => knowledge.forwardLinks(path),
    getLinkGraph: async () => knowledge.graph(),
    searchVault: async ({ query, limit }) => knowledge.search(query, limit),
    listWikiTargets: async () => knowledge.wikiTargets(),
    onKnowledgeUpdated: knowledgeEvents.subscribe,

    // Delegation — no background agent, but the run is simulated against the
    // in-memory vault (running → snapshot → check the box + append a result →
    // done) so the badge, dock, and "Restore original" plumbing are all
    // exercisable. The brief "running" beat matters: the dock only tracks
    // delegations it saw go active this session.
    createDelegation: async ({ sourceFile, index }) => {
      const now = Date.now();
      const id = `fixture-${now}-${index}`;
      // Resolve the checkbox up front (as the host does) so the dock card has
      // a title while the simulated run is still "running".
      const initial = vault.get(sourceFile);
      const resolved = initial === undefined ? null : simulateDelegationEdit(initial, index);
      const delegation: Delegation = {
        id,
        sourceFile,
        anchor: { index, text: resolved?.taskText ?? "", heading: null },
        lineText: resolved?.lineText ?? "",
        status: "running",
        createdAt: now,
        startedAt: now,
        finishedAt: null,
        resultSummary: null,
        error: null,
        hasSnapshot: false,
        restoredAt: null,
      };
      delegations.push(delegation);
      delegationEvents.emit({ delegations: [...delegations] });
      setTimeout(() => {
        const content = vault.get(delegation.sourceFile);
        const edited = content === undefined ? null : simulateDelegationEdit(content, index);
        if (content === undefined || edited === null) {
          delegation.status = "failed";
          delegation.error = "That checkbox is no longer in the file.";
        } else {
          // Mirror the host's ordering: snapshot the pre-run bytes FIRST, then
          // let the "agent" edit, then finish done.
          snapshots.set(id, { path: delegation.sourceFile, content });
          delegation.hasSnapshot = true;
          vault.set(delegation.sourceFile, edited.content);
          vaultEvents.emit({ root: FIXTURE_ROOT });
          delegation.status = "done";
          delegation.anchor = { index, text: edited.taskText, heading: null };
          delegation.lineText = edited.lineText;
          delegation.resultSummary = "Checked it off in the dev harness (simulated).";
        }
        delegation.finishedAt = Date.now();
        delegationEvents.emit({ delegations: [...delegations] });
      }, 800);
      return { ok: true, delegation };
    },
    listDelegations: async () => ({ delegations: [...delegations] }),
    cancelDelegation: async () => ({ ok: false }),
    restoreDelegationSnapshot: async (id) => {
      const delegation = delegations.find((d) => d.id === id);
      if (!delegation) return { ok: false, error: "Unknown delegation." };
      const snapshot = snapshots.get(id);
      if (!snapshot) return { ok: false, error: "No snapshot exists for this delegation." };
      // No-op success when the bytes already match; otherwise write + notify,
      // mirroring the host's restore semantics.
      if (vault.get(delegation.sourceFile) !== snapshot.content) {
        vault.set(delegation.sourceFile, snapshot.content);
        vaultEvents.emit({ root: FIXTURE_ROOT });
      }
      delegation.restoredAt = Date.now();
      delegationEvents.emit({ delegations: [...delegations] });
      return { ok: true };
    },
    onDelegationsUpdated: delegationEvents.subscribe,
    onDelegationStreamed: () => () => {},

    // Inline AI — canned intent classification + streamed generations + a
    // deterministic edit rewrite, so the whole AI menu is drivable.
    generateInlineAi: async ({ prompt, requestId }) => {
      const edited = cannedEditResponse(prompt);
      // Edit prompts return the rewritten markdown whole (the renderer
      // diffs it into suggestions); generate prompts stream deltas.
      if (edited !== null) {
        return new Promise((resolve) => setTimeout(() => resolve({ ok: true, text: edited }), 400));
      }
      // Multi-block markdown so the incremental streaming parse (#370) is
      // exercisable: heading, bold, list, fence, closing paragraph.
      const text = [
        "## Canned heading",
        "",
        "The dev-harness generator streams **markdown** now, and each construct lands as a real block.",
        "",
        "- first canned bullet",
        "- second canned bullet with _emphasis_",
        "",
        "```ts",
        "const canned = true;",
        "```",
        "",
        "A closing paragraph follows the fence.",
      ].join("\n");
      return new Promise((resolve) => {
        streamText(
          text,
          (delta) => aiEvents.emit({ requestId, delta }),
          () => resolve({ ok: true, text }),
        );
      });
    },
    onAiStreamed: aiEvents.subscribe,
    cancelInlineAi: async () => {},
    classifyAiIntent: async ({ prompt }) => ({ intent: cannedIntent(prompt) }),
    generateGhostText: async ({ requestId: _requestId }) =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ ok: true, text: " and this grey continuation came from the harness." }),
          250,
        ),
      ),
    cancelGhostText: async () => {},
    listGhostModels: async () => ({
      models: [
        { id: "canned-fast", label: "Canned Fast" },
        { id: "canned-smart", label: "Canned Smart" },
      ],
      defaultId: "canned-fast",
    }),

    // Executor — not running; mutating calls reject loudly.
    executorStatus: async () => ({ running: false }),
    listExecutorIntegrations: async () => [],
    detectExecutorIntegration: async () => [],
    addMcpIntegration: async () => {
      throw unavailable("executor");
    },
    addOpenApiIntegration: async () => {
      throw unavailable("executor");
    },
    addGraphqlIntegration: async () => {
      throw unavailable("executor");
    },
    removeExecutorIntegration: async () => ({ removed: false }),
    listExecutorConnections: async () => [],
    createExecutorConnection: async () => {
      throw unavailable("executor");
    },
    removeExecutorConnection: async () => ({ removed: false }),
    listExecutorOAuthClients: async () => [],
    createExecutorOAuthClient: async () => {
      throw unavailable("executor");
    },
    ensureGoogleOAuthClient: async () => ({ status: "unavailable" }),
    registerExecutorOAuthClientDynamic: async () => {
      throw unavailable("executor");
    },
    executorOAuthProbe: async () => {
      throw unavailable("executor");
    },
    executorOAuthStart: async () => {
      throw unavailable("executor");
    },
    executorOAuthAwait: async () => null,
    executorOpenExternal: async () => {},

    // Sync — an in-memory account so the settings Sync section is drivable:
    // toggle enable, set a URL, sign in (always succeeds), sync now (stub
    // outcome). onSyncStateChanged makes the section reactive.
    getSyncState: async () => syncState,
    setSyncConfig: async (patch) => {
      syncState = {
        ...syncState,
        enabled: patch.enabled ?? syncState.enabled,
        coordinatorUrl: patch.coordinatorUrl ?? syncState.coordinatorUrl,
      };
      emitSync();
      return syncState;
    },
    syncSignIn: async ({ email }) => {
      syncState = { ...syncState, signedIn: true, email };
      emitSync();
      return { ok: true };
    },
    syncSignOut: async () => {
      syncState = { ...syncState, signedIn: false, email: null, status: { phase: "idle" } };
      emitSync();
    },
    syncNow: async () => {
      if (!syncState.enabled || !syncState.signedIn) {
        const message = "Enable sync and sign in first.";
        syncState = { ...syncState, status: { phase: "error", message } };
        emitSync();
        return { status: "error", message };
      }
      const outcome = { status: "ok", pushed: 2, pulled: 1, deleted: 0, conflicts: 0 } as const;
      syncState = { ...syncState, status: { ...outcome, phase: "ok" } };
      emitSync();
      return outcome;
    },
    onSyncStateChanged: syncEvents.subscribe,

    // Skills / integrations
    listSkills: async () => ({ skills: [] }),
    listIntegrations: async () => [],
    repairIntegrations: async () => {},
  };
}
