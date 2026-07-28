// ---------------------------------------------------------------------------
// In-memory fixture Bridge for the browser dev harness. Fully typed against
// the real Bridge contract — when the IPC registry changes, this file fails
// typecheck. Vault reads/writes hit a Map seeded with sample notes; agent
// chat streams a canned reply; STT streams a canned transcript; TTS queues
// text and emits silent PCM; the executor reports unavailable.
//
// Stub convention for new channels: make the stub DO something real against
// the in-memory state, or throw `unavailable("<feature>")` naming the gap.
// Never silently return `[]`/undefined/false where the real host would act —
// a stub that answers wrong is worse than an error that names itself.
// ---------------------------------------------------------------------------

import type { AiProviderSettings } from "@repo/bridge/ai-provider";
import type { AppAgentEvent } from "@repo/bridge/agent-events";
import type { AppState } from "@repo/bridge/app-state";
import type { Delegation, ListDelegationsResult } from "@repo/bridge/delegation";
import { GHOST_TEXT_ENABLED_UI_STATE, type AiIntent } from "@repo/bridge/inline-ai";
import type { ChatHistoryEntry } from "@repo/bridge/chat-log";
import type { ChatSessionSummary } from "@repo/bridge/chat-sessions";
import type { Bridge, VaultEntry } from "@repo/bridge/ipc-registry";
import type { RemoteAccessState } from "@repo/bridge/remote-access";
import type { ListRoutinesResult, Routine } from "@repo/bridge/routines";
import {
  DAILY_FOLDER_KEY,
  DAILY_FORMAT_KEY,
  DEFAULT_DAILY_FOLDER,
  DEFAULT_DAILY_FORMAT,
} from "@repo/bridge/daily-notes";
import { ELEVENLABS_API_KEY_UI_STATE } from "@repo/bridge/voice";
import type { SyncSignInResult, SyncState } from "@repo/bridge/sync";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { toggleCheckboxLine, toggleTaskAtOrdinal } from "@repo/notes/knowledge/guarded-line-edit";
import { SEARCH_DEFAULT_LIMIT } from "@repo/notes/knowledge/knowledge-index";
import type { KnowledgeStore } from "@repo/notes/knowledge/knowledge-store";
import { scanTaskItems, titleFromPath } from "@repo/notes/knowledge/link-extract";
import { boundGraph, LinkGraphIndex } from "@repo/notes/knowledge/link-graph-index";
import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
import { projectDoc } from "@repo/notes/knowledge/projection";
import { computeRenameEdits } from "@repo/notes/knowledge/rename-links";
import { relatedNotes } from "@repo/notes/knowledge/related-notes";
import { addFrontmatterAlias, notePrivacy } from "@repo/notes/markdown/frontmatter";
import { dailyNotePath, formatIsoDate } from "@repo/notes/daily-path";
import { conflictCopyName, fsSafeStamp } from "@repo/notes/sync/reconcile";

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
  // A folder-inside-a-folder so the sidebar tree shows depth-2 nesting and
  // multi-level indent guides.
  "notes/archive/2025-recap.md": `# 2025 recap

A nested archive note exercising deep folders in the sidebar tree.

- Shipped the vault sync engine
- Ported the editor kits
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
published: true
draft: false
priority: 2
due: 2026-07-01
status: on
tags:
  - meta
  - demo
nested:
  keep: me
---

# Frontmatter note

Edit the typed properties above; the yaml block round-trips byte-for-byte.
`,
  // A `private: true` note so the AI-exclusion surfaces are drivable in the
  // harness: no lock-free AI affordances, read-aloud hidden in the palette,
  // and the header lock badge.
  "private-note.md": `---
private: true
---

# Private note

This note is marked private, so every AI surface skips it on this device.
`,
  // Inline-tag note (tags palette): exercises the palette `#` flow. Its inline
  // #meta unifies with frontmatter-note.md's frontmatter `tags: [meta, demo]`,
  // so the tag list demos BOTH sources (meta count 2) and inline-only tags.
  // Pre-canonical prose (the corpus test pins it canonical).
  "tagged.md": `# Tagged note

Inline tags: working on #project and #meta this week, with #ideas to chase.

A nested tag #area/deep-dive lives here too.
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

/** Simulate the background agent's edit: check the `ordinal`-th task item off
 * (the REAL core primitives — scanTaskItems locates by the shared ordinal
 * contract, toggleCheckboxLine flips only the marker char) and append a
 * nested one-line result under it. Null when the ordinal doesn't land on an
 * unchecked task item, mirroring the host's findTaskLine rejections. */
function simulateDelegationEdit(
  content: string,
  ordinal: number,
): { content: string; taskText: string; lineText: string } | null {
  const task = scanTaskItems(content).find((t) => t.ordinal === ordinal);
  if (!task || task.checked) return null;
  const toggled = toggleCheckboxLine(content, task.line - 1, task.raw);
  if (!toggled.ok) return null;
  const indent = /^\s*/.exec(task.raw)?.[0] ?? "";
  const lines = toggled.content.split("\n");
  lines.splice(task.line, 0, `${indent}  - ✅ Done in the dev harness (simulated edit)`);
  return { content: lines.join("\n"), taskText: task.text, lineText: task.raw };
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
  // Template fixtures so "New note from template…" and the daily-note
  // seed are drivable in the harness. Kept out of SAMPLE_NOTES: they carry
  // {{date}}/{{title}} placeholders + frontmatter that the corpus contract
  // (every entry canonical) doesn't model — they're only ever read as template
  // bytes, never opened as a canonical note.
  "templates/meeting.md": `---
type: meeting
date: {{date}}
---

# {{title}}

**Date:** {{date}}

## Attendees

-

## Notes

## Action items

- [ ]
`,
  "templates/daily.md": `---
type: daily
date: {{date}}
---

# {{title}}

## Focus

## Log
`,
  // An HTML App fixture so the sandboxed-app surface is drivable in the harness
  // (which has no vault-app:// protocol — the view falls back to a blob URL with
  // the same runtime injected). Exercises Alpine (the counter) + the injected
  // window.inteligir.files bridge (the note list). Not in SAMPLE_NOTES: it's not
  // a doc, so the markdown-corpus contract doesn't apply.
  // Project cluster — typed frontmatter so the dashboard HTML app can query
  // "project", pull each hit's properties, and sort a table by priority. All
  // three link [[hub]] so `backlinks("wiki/hub.md")` returns a real, deduped set.
  "projects/alpha.md": `---
title: Project Alpha
status: active
priority: 1
due: 2026-08-15
---

# Project Alpha

The flagship project. Tracks against [[hub]].
`,
  "projects/beta.md": `---
title: Project Beta
status: paused
priority: 3
due: 2026-09-01
---

# Project Beta

A secondary project effort, parked for now. See [[hub]].
`,
  "projects/gamma.md": `---
title: Project Gamma
status: active
priority: 2
due: 2026-07-20
---

# Project Gamma

Exploratory project work, links back to [[hub]].
`,
  "demo-app.html": `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Notes Explorer</title>
  </head>
  <body>
    <div x-data="notesApp()" x-init="load()" class="mx-auto max-w-md">
      <h1 class="mb-3 text-lg font-semibold">Notes Explorer</h1>
      <button
        class="mb-4 rounded border px-3 py-1"
        style="border-color: var(--border)"
        x-on:click="count++"
      >
        Count: <span x-text="count"></span>
      </button>
      <ul class="space-y-1" data-testid="note-list">
        <template x-for="note in notes" :key="note.path">
          <li>
            <button class="text-left underline" x-on:click="open(note.path)" x-text="note.name"></button>
          </li>
        </template>
      </ul>
    </div>
    <script>
      function notesApp() {
        return {
          count: 0,
          notes: [],
          async load() {
            this.notes = await window.inteligir.files.list();
          },
          open(path) {
            window.inteligir.files.open(path);
          },
        };
      }
    </script>
  </body>
</html>
`,
  "dashboard-demo.html": `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Project Dashboard</title>
  </head>
  <body>
    <div x-data="dashboard()" x-init="load()" class="mx-auto max-w-2xl p-4">
      <h1 class="mb-1 text-lg font-semibold">Project Dashboard</h1>
      <p class="mb-4 text-sm" style="color: var(--muted)">
        Notes matching "<span x-text="query"></span>", sorted by priority.
      </p>
      <table class="w-full text-sm" data-testid="project-table">
        <thead>
          <tr class="border-b text-left" style="border-color: var(--border)">
            <th class="py-1 pr-3">Name</th>
            <th class="py-1 pr-3">Status</th>
            <th class="py-1 pr-3">Priority</th>
            <th class="py-1 pr-3">Due</th>
          </tr>
        </thead>
        <tbody>
          <template x-for="row in rows" :key="row.path">
            <tr class="border-b" style="border-color: var(--border)">
              <td class="py-1 pr-3">
                <button class="underline" x-on:click="open(row.path)" x-text="row.name"></button>
              </td>
              <td class="py-1 pr-3" x-text="prop(row, 'status')"></td>
              <td class="py-1 pr-3" x-text="prop(row, 'priority')"></td>
              <td class="py-1 pr-3" x-text="prop(row, 'due')"></td>
            </tr>
          </template>
        </tbody>
      </table>
      <h2 class="mt-6 mb-1 text-sm font-semibold">Backlinks to hub</h2>
      <ul class="space-y-1 text-sm" data-testid="backlink-list">
        <template x-for="path in backlinks" :key="path">
          <li x-text="path"></li>
        </template>
      </ul>
    </div>
    <script>
      function dashboard() {
        return {
          query: "project",
          rows: [],
          backlinks: [],
          async load() {
            const hits = await window.inteligir.files.list({
              query: this.query,
              withProperties: true,
              limit: 50,
            });
            this.rows = hits
              .slice()
              .sort((a, b) => (this.prop(a, "priority") ?? 0) - (this.prop(b, "priority") ?? 0));
            this.backlinks = await window.inteligir.files.backlinks("wiki/hub.md");
          },
          prop(row, key) {
            return row.properties ? row.properties[key] : undefined;
          },
          open(path) {
            window.inteligir.files.open(path);
          },
        };
      }
    </script>
  </body>
</html>
`,
};

/** Tiny non-crypto content hash (FNV-1a): the store wants a value that
 * changes with the bytes, and the harness has no node:crypto. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** `openKnowledgeStore` injects the persistent search store (the harness
 * bootstrap passes core's SQL store over the wasm driver), mirroring how the
 * desktop shell injects the node:sqlite store into KnowledgeManager. */
export function createFixtureBridge(openKnowledgeStore: (root: string) => KnowledgeStore): Bridge {
  const vault = new Map<string, string>([
    ...Object.entries(SAMPLE_NOTES),
    ...Object.entries(SAMPLE_ASSETS),
  ]);
  // Real image bytes pasted/dropped during a harness session, base64-keyed by
  // vault path — the in-memory twin of the host's on-disk assets/ folder, so
  // writeVaultAsset → render → reload round-trips without a real filesystem.
  const assetBytes = new Map<string, string>();
  // Ghost text defaults ON in the harness — there is no cost here and the
  // whole AI surface should be drivable out of the box.
  const uiState: Record<string, unknown> = { [GHOST_TEXT_ENABLED_UI_STATE]: true };
  const history: ChatHistoryEntry[] = [];
  // Past chat threads for the read-only session browser — real in-memory
  // sample sessions (the harness twin of SESSION_DIR), so "Browse past
  // chats" lists, opens, and error-paths are all drivable without a host.
  const pastSessions: { summary: ChatSessionSummary; entries: ChatHistoryEntry[] }[] = [
    {
      summary: {
        id: "fx-plan-week",
        title: "Help me plan this week from my open tasks",
        updatedAt: Date.now() - 26 * 60 * 60 * 1000,
        messageCount: 4,
      },
      entries: [
        { role: "user", text: "Help me plan this week from my open tasks" },
        {
          role: "assistant",
          text: "Here's a plan built from your open tasks:\n\n1. **Monday** — finish the sync writeup\n2. **Wednesday** — review the garden notes\n3. **Friday** — clear the reading queue",
        },
        { role: "user", text: "Move the reading queue to Thursday" },
        { role: "assistant", text: "Done — the reading queue is now on Thursday." },
      ],
    },
    {
      summary: {
        id: "fx-atlas-links",
        title: "Which notes link to Project Atlas?",
        updatedAt: Date.now() - 4 * 24 * 60 * 60 * 1000,
        messageCount: 2,
      },
      entries: [
        { role: "user", text: "Which notes link to Project Atlas?" },
        {
          role: "assistant",
          text: "Two notes link to **Project Atlas**: `journal/2026-07-14.md` and `ideas/roadmap.md`.",
        },
      ],
    },
  ];
  const delegations: Delegation[] = [];
  // Pre-run copies keyed by delegation id — the in-memory twin of the host's
  // ~/.inteligir/snapshots store, so "Restore original" is exercisable.
  const snapshots = new Map<string, { path: string; content: string }>();
  // The pending simulated-run timer per delegation id, so cancelDelegation
  // can really pull a "running" run back (clearTimeout = the harness twin of
  // the host's agent interrupt).
  const delegationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Status transitions build a fresh record (Delegation is a union
  // discriminated on `status` — in-place mutation can't change variant) and
  // swap it into the list, then broadcast — the host manager's update+notify.
  const replaceDelegation = (next: Delegation): void => {
    const at = delegations.findIndex((d) => d.id === next.id);
    if (at !== -1) delegations[at] = next;
    delegationEvents.emit({ delegations: [...delegations] });
  };
  // Routines — durable config in memory; "Run now" simulates the host run
  // (running → snapshot → host-side append → done). The boot scheduler is
  // host-only: no timers fire on a wall clock here.
  const routines: Routine[] = [];
  let routineRunningId: string | null = null;
  // Pre-run copies keyed by runId — the twin of the routine-origin snapshots.
  const routineSnapshots = new Map<string, { path: string; content: string | null }>();
  const emitRoutines = (): void => {
    routineEvents.emit({ routines: [...routines], runningId: routineRunningId });
  };
  const replaceRoutine = (next: Routine): void => {
    const at = routines.findIndex((r) => r.id === next.id);
    if (at !== -1) routines[at] = next;
    emitRoutines();
  };
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
    conflicts: [],
  };
  // Remote access — no ws server runs in a browser tab, so enabling simulates
  // the listening state and a LAN URL; one pre-paired device makes the device
  // list + Revoke exercisable out of the box.
  let remoteAccessState: RemoteAccessState = {
    enabled: false,
    port: 47890,
    listening: false,
    lanUrls: [],
    devices: [
      {
        id: "fixture-device",
        name: "Fixture Phone",
        createdAt: "2026-07-01T09:00:00.000Z",
        lastSeenAt: "2026-07-09T18:30:00.000Z",
      },
    ],
  };

  // AI provider — an in-memory mirror of the host's provider-service so the
  // Settings AI section is fully drivable: switch (defaults the model like
  // applySelectionPatch), connect (simulates a COMPLETED OAuth round-trip —
  // the real host opens the system browser here), disconnect.
  const aiProviderCatalog = [
    {
      id: "openai-codex",
      label: "OpenAI",
      requiresAuth: true,
      defaultModelId: "gpt-5.5",
      models: [
        { id: "gpt-5.5", label: "GPT-5.5" },
        { id: "gpt-5.4", label: "GPT-5.4" },
        { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
      ],
    },
    {
      id: "anthropic",
      label: "Claude",
      requiresAuth: true,
      defaultModelId: "claude-sonnet-5",
      models: [
        { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
        { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
        { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (latest)" },
      ],
    },
  ];
  const aiConnected = new Map<string, boolean>([
    ["openai-codex", true],
    ["anthropic", false],
  ]);
  let aiSelection = { provider: "openai-codex", modelId: "gpt-5.5" };
  const aiProviderSettings = (): AiProviderSettings => ({
    selected: { ...aiSelection },
    providers: aiProviderCatalog.map((entry) => ({
      ...entry,
      connected: aiConnected.get(entry.id) === true,
    })),
  });
  const aiProviderEntry = (provider: string) => {
    const entry = aiProviderCatalog.find((candidate) => candidate.id === provider);
    if (!entry) throw new Error(`Unknown AI provider "${provider}"`);
    return entry;
  };

  const agentEvents = new Emitter<AppAgentEvent>();
  const appStateEvents = new Emitter<AppState>();
  const sttEvents = new Emitter<{ text: string; isFinal: boolean }>();
  let sttTimers: ReturnType<typeof setTimeout>[] = [];
  let sttFinalPending = false;
  const ttsAudioEvents = new Emitter<{ audio: ArrayBuffer }>();
  // Mirrors the host TTS proxy's pending-text model: sends queue text (each
  // emitting a silent PCM chunk so the renderer's playback path runs), flush
  // finalizes the queued utterance into `spoken`, interrupt discards it; the
  // "secret" half of setVoiceApiKey lands in `apiKey` (ui-state gets only the
  // presence marker, like the host). Inspectable from harness devtools.
  const ttsState: { apiKey: string | null; pending: string[]; spoken: string[] } = {
    apiKey: null,
    pending: [],
    spoken: [],
  };
  // Reachable from harness devtools/drivers on purpose: "what would the host
  // have spoken" assertions (voice narration, read-aloud) read this queue.
  Object.assign(globalThis, { __fixtureTts: ttsState });
  const vaultEvents = new Emitter<{ root: string }>();
  const aiEvents = new Emitter<{ requestId: string; delta: string }>();
  const delegationEvents = new Emitter<ListDelegationsResult>();
  const routineEvents = new Emitter<ListRoutinesResult>();
  const knowledgeEvents = new Emitter<Record<string, never>>();
  const syncEvents = new Emitter<SyncState>();
  const emitSync = () => syncEvents.emit(syncState);
  const socialResultEvents = new Emitter<SyncSignInResult>();
  const remoteAccessEvents = new Emitter<RemoteAccessState>();
  const emitRemoteAccess = () => remoteAccessEvents.emit(remoteAccessState);

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

  // The REAL knowledge engine over the in-memory vault, in the SAME
  // composition the desktop host runs (knowledge-manager.ts): the pure
  // LinkGraphIndex resolves links/tags/graph in memory, and the injected SQL
  // KnowledgeStore (wasm-backed here, node:sqlite on desktop) owns FTS5 bm25
  // search — so harness search ranks exactly like the product.
  const linkGraph = new LinkGraphIndex();
  const knowledgeStore = openKnowledgeStore(FIXTURE_ROOT);
  // Stat identity is fabricated (no filesystem behind the Map): a fresh
  // monotonic fingerprint per write — nothing in the harness diffs it.
  let fingerprintSeq = 0;
  // When each path was last written into the Map — the harness's "disk" has no
  // mtime, but indexEntry runs after every write (and once per seeded note at
  // boot), so this is a REAL last-modified for the fixture vault, not a canned
  // constant. Backs getVaultFileFacts alongside the content's byte length.
  const writtenAtMs = new Map<string, number>();
  const indexEntry = (path: string): void => {
    const content = vault.get(path);
    if (content === undefined) return;
    writtenAtMs.set(path, Date.now());
    if (isDocPath(path)) {
      const projection = projectDoc(path, content);
      linkGraph.applyDoc(path, projection);
      fingerprintSeq++;
      knowledgeStore.upsertDoc(
        {
          path,
          fingerprint: { mtimeMs: fingerprintSeq, size: content.length, ino: fingerprintSeq },
          contentHash: fnv1a(content),
          projection,
        },
        content,
      );
    } else {
      linkGraph.setOther(path);
      knowledgeStore.upsertOther(path);
    }
  };
  const removeEntry = (path: string): void => {
    writtenAtMs.delete(path);
    linkGraph.remove(path);
    knowledgeStore.remove(path);
  };
  knowledgeStore.transaction(() => {
    for (const path of vault.keys()) indexEntry(path);
  });
  const touchVault = (): void => {
    vaultEvents.emit({ root: FIXTURE_ROOT });
    knowledgeEvents.emit({});
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
    // App lifecycle
    getAppState: async () => appState,
    transition: async (event) => {
      switch (event.type) {
        case "SETUP":
        case "RETRY":
        case "NEW_SESSION":
          history.length = 0;
          setAppState({ phase: "ready", agent: "idle" });
          return;
        case "RESET_APP_DATA":
          // The harness twin of the host's full ~/.inteligir wipe + re-setup:
          // clear chat history, sign the sync account out and disable it, and
          // drop every simulated provider connection. Phase mimics the real
          // machine — setting_up first, ready after a beat — because renderer
          // consumers key refreshes off the setting_up→ready transition (the
          // ai-provider store re-snapshots there).
          history.length = 0;
          syncState = {
            enabled: false,
            signedIn: false,
            email: null,
            coordinatorUrl: "",
            status: { phase: "idle" },
            conflicts: [],
          };
          emitSync();
          for (const id of aiConnected.keys()) aiConnected.set(id, false);
          setAppState({ phase: "setting_up" });
          setTimeout(() => setAppState({ phase: "ready", agent: "idle" }), 400);
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
    // Read-only past-chat browser over the in-memory sample sessions above.
    // Unknown ids answer with the host's { ok: false } VALUE, so the
    // browser's inline error path is exercisable too.
    listChatSessions: async () => pastSessions.map((s) => Object.assign({}, s.summary)),
    readChatSession: async ({ id }) => {
      const session = pastSessions.find((s) => s.summary.id === id);
      return session
        ? { ok: true, entries: session.entries.map((e) => Object.assign({}, e)) }
        : { ok: false, error: `No session with id "${id}"` };
    },
    reauthenticate: async () => ({ ok: true }),
    setFauxAgentScript: async () => {
      throw unavailable(
        "faux agent scripting (run the real host: pnpm dev:desktop with INTELIGIR_FAUX_AGENT=1)",
      );
    },
    getAgentSystemPrompt: async () => {
      throw unavailable(
        "agent system-prompt inspection (run the real host: pnpm dev:desktop with INTELIGIR_FAUX_AGENT=1)",
      );
    },

    // AI provider — the in-memory mirror above; switch/connect/disconnect all
    // mutate it so the Settings section's states are exercisable.
    getAiProviderSettings: async () => aiProviderSettings(),
    setAiProviderConfig: async (patch) => {
      const provider = patch.provider ?? aiSelection.provider;
      const entry = aiProviderEntry(provider);
      const modelId =
        patch.modelId ??
        (provider === aiSelection.provider ? aiSelection.modelId : entry.defaultModelId);
      if (!entry.models.some((model) => model.id === modelId)) {
        throw new Error(`Model "${modelId}" is not available for AI provider "${provider}"`);
      }
      aiSelection = { provider, modelId };
      return aiProviderSettings();
    },
    connectAiProvider: async ({ provider }) => {
      aiProviderEntry(provider);
      aiConnected.set(provider, true);
      return { ok: true };
    },
    disconnectAiProvider: async ({ provider }) => {
      aiProviderEntry(provider);
      aiConnected.set(provider, false);
      return aiProviderSettings();
    },

    // Voice — TTS is REAL against in-memory state: always "configured", the
    // API key mirrors the host (secret held here, `true` presence marker in
    // ui-state), sends/flushes/interrupts drive the ttsState queue above and
    // emit silent PCM so playback is exercisable. STT is SIMULATED: startStt
    // arms timers that stream a canned transcript so the listening capsule is
    // demoable.
    isTtsAvailable: async () => true,
    setVoiceApiKey: async ({ value }) => {
      const secret = typeof value === "string" ? value.trim() : "";
      if (secret.length > 0) {
        ttsState.apiKey = secret;
        uiState[ELEVENLABS_API_KEY_UI_STATE] = true;
      } else {
        ttsState.apiKey = null;
        delete uiState[ELEVENLABS_API_KEY_UI_STATE];
      }
    },
    ttsSend: ({ text }) => {
      ttsState.pending.push(text);
      // ~50ms of 24kHz Int16 silence per chunk — the renderer schedules and
      // "plays" it, so the audio path runs without real synthesis.
      ttsAudioEvents.emit({ audio: new Int16Array(1200).buffer });
    },
    ttsFlush: () => {
      ttsState.spoken.push(...ttsState.pending.splice(0));
    },
    ttsInterrupt: () => {
      ttsState.pending.length = 0;
    },
    onTtsAudio: ttsAudioEvents.subscribe,
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
    chooseVaultRoot: async () => ({ ok: false, reason: "canceled" }),
    listVault: async () => listEntries(),
    readVaultDoc: async ({ path }) => {
      const content = vault.get(path);
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return content;
    },
    // Real facts about the in-memory "disk": UTF-8 byte length of the stored
    // content, and the moment that content was last written (writtenAtMs).
    // Absent path → null, matching the host's unstat'able verdict.
    getVaultFileFacts: async ({ path }) => {
      const content = vault.get(path);
      const modifiedMs = writtenAtMs.get(path);
      if (content === undefined || modifiedMs === undefined) return null;
      return { sizeBytes: new TextEncoder().encode(content).length, modifiedMs };
    },
    writeVaultDoc: async ({ path, content }) => {
      vault.set(path, content);
      indexEntry(path);
      touchVault();
    },
    deleteVaultEntry: async ({ path }) => {
      const removed = vault.delete(path);
      if (removed) {
        removeEntry(path);
        touchVault();
        // Mirror the host: deleting a conflict copy resolves its conflict row.
        if (syncState.conflicts.some((conflict) => conflict.path === path)) {
          syncState = {
            ...syncState,
            conflicts: syncState.conflicts.filter((conflict) => conflict.path !== path),
          };
          emitSync();
        }
      }
      return { removed };
    },
    renameVaultEntry: async ({ from, to }) => {
      const content = vault.get(from);
      if (content === undefined) return { ok: false, error: `no such file: ${from}` };
      // Host parity: the destination basename passes the note-name gate.
      const verdict = checkNoteName(to.split("/").at(-1) ?? to);
      if (!verdict.ok) return { ok: false, error: noteNameErrorMessage(verdict.reason) };
      // Host parity: case-insensitive occupied check (a DIFFERENT file
      // claiming the name refuses; a case-only self-rename passes).
      const wanted = to.normalize("NFC").toLowerCase();
      for (const path of vault.keys()) {
        if (path === from) continue;
        if (path.normalize("NFC").toLowerCase() === wanted) {
          return { ok: false, error: `already exists: ${to}` };
        }
      }
      // Mirror the host: rename, then rewrite every link that pointed at the
      // old path (same pure core edit computation), then record the old stem
      // as an alias on the moved doc (rename-rewrite's phase 3).
      const docs = new Map<string, string>();
      for (const [path, text] of vault) {
        if (isDocPath(path)) docs.set(path, text);
      }
      const edits = computeRenameEdits(docs, vault.keys(), from, to);
      vault.delete(from);
      removeEntry(from);
      const oldStem = titleFromPath(from);
      const recordAlias =
        isDocPath(from) &&
        isDocPath(to) &&
        oldStem !== "" &&
        oldStem.toLowerCase() !== titleFromPath(to).toLowerCase();
      const moved = edits.get(to) ?? content;
      vault.set(to, recordAlias ? (addFrontmatterAlias(moved, oldStem) ?? moved) : moved);
      for (const [path, text] of edits) {
        if (path !== to) vault.set(path, text);
      }
      indexEntry(to);
      for (const path of edits.keys()) {
        if (path !== to) indexEntry(path);
      }
      touchVault();
      return { ok: true };
    },
    writeVaultAsset: async ({ dir, baseName, bytesBase64 }) => {
      const leaf = (baseName.split(/[/\\]/).pop() ?? "").replace(/^\.+/, "").trim() || "image";
      const cleanDir = dir.replaceAll(/^\/+|\/+$/g, "") || "assets";
      const dot = leaf.lastIndexOf(".");
      const stem = dot > 0 ? leaf.slice(0, dot) : leaf;
      const ext = dot > 0 ? leaf.slice(dot) : "";
      let path = `${cleanDir}/${leaf}`;
      for (let i = 1; vault.has(path); i++) path = `${cleanDir}/${stem}-${i}${ext}`;
      vault.set(path, "asset-bytes (dev harness fixture)");
      assetBytes.set(path, bytesBase64);
      indexEntry(path);
      touchVault();
      return { path };
    },
    readVaultAsset: async ({ path }) => {
      const bytesBase64 = assetBytes.get(path);
      if (bytesBase64 === undefined) return { ok: false, error: `no bytes for: ${path}` };
      return { ok: true, bytesBase64 };
    },
    // No vault-app:// protocol in the browser harness — the HTML-App view falls
    // back to a blob: URL, so the token is unused. Return a stable stub.
    mintHtmlAppToken: async () => "harness-html-app-token",
    // No live token store in the harness (no vault-app:// protocol) — the
    // revoke call is a no-op, matching the mint stub above.
    revokeHtmlAppToken: async () => {},
    // The real probe reads live disk; the harness's "disk" is the Map — same
    // fail-closed verdict shape (notePrivacy + absent) as the host handler.
    probeNotePrivacy: async ({ path }) => {
      const content = vault.get(path);
      return content === undefined ? "absent" : notePrivacy(content);
    },
    // No filesystem to watch in the harness — the in-memory Map fires touchVault
    // directly on every write, so there is no external-edit channel to arm.
    setWatchedNote: async () => {},
    // The harness has no external mutations to discover, but re-emitting keeps
    // the "Refresh vault" command exercisable (sidebar re-lists, panes re-query).
    refreshVault: async () => touchVault(),
    onVaultChanged: vaultEvents.subscribe,

    // Knowledge — live queries: link graph in memory, search through FTS5.
    getBacklinks: async ({ path }) => linkGraph.backlinks(path),
    getForwardLinks: async ({ path }) => linkGraph.forwardLinks(path),
    // The REAL scorer in the host's exact composition: pure graph + the SQL
    // store's FTS5 bm25 as the lexical port.
    getRelatedNotes: async ({ path }) =>
      relatedNotes(linkGraph, (query, limit) => knowledgeStore.search(query, limit), path),
    // Bounded through the SAME pure pass the host handler uses, so the
    // "showing N of M" affordance is exercisable in the harness (drop the
    // caps low against the sample vault and it fires).
    getLinkGraph: async (bounds) => boundGraph(linkGraph.graph(), bounds),
    searchVault: async ({ query, limit }) =>
      knowledgeStore.search(query, limit ?? SEARCH_DEFAULT_LIMIT),
    listWikiTargets: async () => linkGraph.wikiTargets(),
    listTags: async () => linkGraph.tags(),
    getNotesByTag: async ({ tag }) => linkGraph.notesWithTag(tag),
    listVaultTasks: async () => linkGraph.tasks(),
    // The REAL guarded toggle over the in-memory vault — same ordinal +
    // raw-equality contract as the host handler; refusals are values.
    toggleVaultTask: async ({ path, ordinal, expectedRaw }) => {
      const content = vault.get(path);
      if (content === undefined) {
        return { ok: false, reason: "line-missing", error: `no such file: ${path}` };
      }
      const result = toggleTaskAtOrdinal(content, ordinal, expectedRaw);
      if (!result.ok) {
        return { ok: false, reason: result.reason, error: "The note changed under the task list." };
      }
      vault.set(path, result.content);
      indexEntry(path);
      touchVault();
      return { ok: true, checked: result.checked };
    },
    onKnowledgeUpdated: knowledgeEvents.subscribe,

    // Delegation — no background agent, but the run is simulated against the
    // in-memory vault (running → snapshot → check the box + append a result →
    // done) so the badge, dock, and "Restore original" plumbing are all
    // exercisable. The brief "running" beat matters: the dock only tracks
    // delegations it saw go active this session.
    createDelegation: async ({ sourceFile, ordinal }) => {
      // Mirror the host's provider feature gate: a guest — selected
      // provider not connected — gets the same graceful refusal, never a
      // silently queued run.
      const selectedEntry = aiProviderCatalog.find((entry) => entry.id === aiSelection.provider);
      const selectedConnected =
        selectedEntry !== undefined &&
        (!selectedEntry.requiresAuth || aiConnected.get(selectedEntry.id) === true);
      if (!selectedConnected) {
        return { ok: false, error: "Connect an AI provider in Settings → AI to delegate." };
      }
      const now = Date.now();
      const id = `fixture-${now}-${ordinal}`;
      // Resolve the checkbox up front (as the host does) so the dock card has
      // a title while the simulated run is still "running".
      const initial = vault.get(sourceFile);
      const resolved = initial === undefined ? null : simulateDelegationEdit(initial, ordinal);
      const delegation: Extract<Delegation, { status: "running" }> = {
        id,
        sourceFile,
        anchor: { ordinal, text: resolved?.taskText ?? "", heading: null },
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
      const timer = setTimeout(() => {
        delegationTimers.delete(id);
        const content = vault.get(delegation.sourceFile);
        const edited = content === undefined ? null : simulateDelegationEdit(content, ordinal);
        if (content === undefined || edited === null) {
          replaceDelegation({
            ...delegation,
            status: "failed",
            error: "That checkbox is no longer in the file.",
            finishedAt: Date.now(),
          });
          return;
        }
        // Mirror the host's ordering: snapshot the pre-run bytes FIRST, then
        // let the "agent" edit, then finish done. Completion re-indexes +
        // broadcasts (the host's onRunSettled vault refresh — vault
        // liveness, CLAUDE.md § Decisions) so
        // knowledge consumers — the tasks view included — see the edit.
        snapshots.set(id, { path: delegation.sourceFile, content });
        vault.set(delegation.sourceFile, edited.content);
        indexEntry(delegation.sourceFile);
        touchVault();
        replaceDelegation({
          ...delegation,
          status: "done",
          anchor: { ordinal, text: edited.taskText, heading: null },
          lineText: edited.lineText,
          resultSummary: "Checked it off in the dev harness (simulated).",
          hasSnapshot: true,
          finishedAt: Date.now(),
        });
      }, 800);
      delegationTimers.set(id, timer);
      return { ok: true, delegation };
    },
    listDelegations: async () => ({ delegations: [...delegations] }),
    // A REAL cancel over the simulated run (a throw here would be swallowed
    // by delegation-store's fire-and-forget .catch): pull the pending timer
    // and land the host's stop outcome — status "failed", error "Stopped." —
    // so the dock badge visibly flips. A finished/unknown id can't be pulled
    // back, exactly like the host manager.
    cancelDelegation: async (id) => {
      const delegation = delegations.find((d) => d.id === id);
      const timer = delegationTimers.get(id);
      if (!delegation || delegation.status !== "running" || timer === undefined) {
        return { ok: false };
      }
      clearTimeout(timer);
      delegationTimers.delete(id);
      replaceDelegation({
        ...delegation,
        status: "failed",
        error: "Stopped.",
        finishedAt: Date.now(),
      });
      return { ok: true };
    },
    restoreDelegationSnapshot: async (id) => {
      const delegation = delegations.find((d) => d.id === id);
      if (!delegation) return { ok: false, error: "Unknown delegation." };
      const snapshot = snapshots.get(id);
      if (!snapshot) return { ok: false, error: "No snapshot exists for this delegation." };
      // Unreachable while a run is in flight (a snapshot only exists once the
      // simulated run finished) — the guard mirrors the host manager and
      // narrows to the terminal variants, the only ones carrying restoredAt.
      if (delegation.status === "queued" || delegation.status === "running") {
        return { ok: false, error: "Wait for the delegation to finish before restoring." };
      }
      // No-op success when the bytes already match; otherwise write + notify,
      // mirroring the host's restore semantics.
      if (vault.get(delegation.sourceFile) !== snapshot.content) {
        vault.set(delegation.sourceFile, snapshot.content);
        vaultEvents.emit({ root: FIXTURE_ROOT });
      }
      replaceDelegation({ ...delegation, restoredAt: Date.now() });
      return { ok: true };
    },
    onDelegationsUpdated: delegationEvents.subscribe,
    onDelegationStreamed: () => () => {},

    // Routines — Settings CRUD is real against the in-memory list; "Run now"
    // simulates the host run against the in-memory vault (running → snapshot
    // → append a result block → done), so status, the appended note, and
    // "Restore" are all exercisable. Private targets refuse like the host.
    listRoutines: async () => ({ routines: [...routines], runningId: routineRunningId }),
    upsertRoutine: async (params) => {
      if (params.target.kind === "note") {
        const raw = vault.get(params.target.path);
        if (raw !== undefined && notePrivacy(raw) !== "public") {
          return {
            ok: false,
            error:
              "The target note is private — running would send its content to the AI provider.",
          };
        }
      }
      if (params.id === undefined) {
        const routine: Routine = {
          id: `fixture-routine-${Date.now()}`,
          name: params.name,
          prompt: params.prompt,
          schedule: params.schedule,
          target: params.target,
          enabled: params.enabled,
          createdAt: Date.now(),
          lastRunAt: null,
          lastRun: null,
        };
        routines.push(routine);
        emitRoutines();
        return { ok: true, routine };
      }
      const existing = routines.find((r) => r.id === params.id);
      if (!existing) return { ok: false, error: "Unknown routine." };
      const updated: Routine = {
        ...existing,
        name: params.name,
        prompt: params.prompt,
        schedule: params.schedule,
        target: params.target,
        enabled: params.enabled,
      };
      replaceRoutine(updated);
      return { ok: true, routine: updated };
    },
    deleteRoutine: async (id) => {
      const at = routines.findIndex((r) => r.id === id);
      if (at === -1) return { ok: false };
      routines.splice(at, 1);
      emitRoutines();
      return { ok: true };
    },
    runRoutineNow: async (id) => {
      const routine = routines.find((r) => r.id === id);
      if (!routine) return { ok: false, error: "Unknown routine." };
      if (routineRunningId !== null)
        return { ok: false, error: "This routine is already running." };
      const now = new Date();
      const folder = uiState[DAILY_FOLDER_KEY];
      const format = uiState[DAILY_FORMAT_KEY];
      const path =
        routine.target.kind === "daily"
          ? dailyNotePath(
              typeof folder === "string" ? folder : DEFAULT_DAILY_FOLDER,
              typeof format === "string" ? format : DEFAULT_DAILY_FORMAT,
              now,
            )
          : routine.target.path;
      routineRunningId = id;
      const startedAt = Date.now();
      replaceRoutine({ ...routine, lastRunAt: startedAt });
      setTimeout(() => {
        const runId = `fixture-run-${Date.now()}`;
        const current = vault.get(path) ?? null;
        const settle = (next: Routine): void => {
          routineRunningId = null;
          replaceRoutine(next);
        };
        // The host's fail-closed privacy check at run time.
        if (current !== null && notePrivacy(current) !== "public") {
          settle({
            ...routine,
            lastRunAt: startedAt,
            lastRun: {
              status: "failed",
              runId,
              path,
              startedAt,
              finishedAt: Date.now(),
              error:
                "The target note is private — running would send its content to the AI provider.",
              hasSnapshot: false,
              restoredAt: null,
            },
          });
          return;
        }
        // Snapshot BEFORE the "agent" output lands, mirroring the host order.
        routineSnapshots.set(runId, { path, content: current });
        const summary = "Simulated routine result from the dev harness.";
        const block = `## ${routine.name} — ${formatIsoDate(now)}\n\n${summary}\n`;
        const appended =
          current === null || current === ""
            ? block
            : current.endsWith("\n\n")
              ? current + block
              : current.endsWith("\n")
                ? `${current}\n${block}`
                : `${current}\n\n${block}`;
        vault.set(path, appended);
        indexEntry(path);
        touchVault();
        settle({
          ...routine,
          lastRunAt: startedAt,
          lastRun: {
            status: "done",
            runId,
            path,
            startedAt,
            finishedAt: Date.now(),
            summary,
            hasSnapshot: true,
            restoredAt: null,
          },
        });
      }, 800);
      return { ok: true };
    },
    restoreRoutineRun: async (id) => {
      const routine = routines.find((r) => r.id === id);
      if (!routine) return { ok: false, error: "Unknown routine." };
      if (routineRunningId === id) {
        return { ok: false, error: "Wait for the routine to finish before restoring." };
      }
      const lastRun = routine.lastRun;
      if (lastRun === null || !lastRun.hasSnapshot) {
        return { ok: false, error: "No saved copy exists for this routine's last run." };
      }
      const snapshot = routineSnapshots.get(lastRun.runId);
      if (!snapshot) return { ok: false, error: "The saved copy is missing." };
      if (snapshot.content === null) {
        // The run created the note — undo deletes it (host: OS trash).
        if (vault.delete(snapshot.path)) {
          removeEntry(snapshot.path);
          touchVault();
        }
      } else if (vault.get(snapshot.path) !== snapshot.content) {
        vault.set(snapshot.path, snapshot.content);
        indexEntry(snapshot.path);
        touchVault();
      }
      replaceRoutine({ ...routine, lastRun: { ...lastRun, restoredAt: Date.now() } });
      return { ok: true };
    },
    onRoutinesUpdated: routineEvents.subscribe,

    // AI-write checkpoints — the harness chat agent is a canned echo that
    // never edits notes, so no capture event ever fires; a restore arriving
    // anyway is a wiring bug worth hearing.
    onAgentEditCaptured: () => () => {},
    restoreAgentEdits: async ({ ids }) => {
      throw new Error(
        `fixture bridge: restoreAgentEdits(${ids.join(",")}) — no chat checkpoints exist in the harness`,
      );
    },

    // Deep-link capture — no URL scheme reaches a browser tab, so the apply
    // event never fires; an ack arriving anyway is a wiring bug worth hearing.
    onCaptureApply: () => () => {},
    ackCapture: async ({ id }) => {
      throw new Error(`fixture bridge: ackCapture(${id}) — no capture inbox exists in the harness`);
    },
    onDeepLinkNav: () => () => {},
    // Genuinely nothing parked — a browser tab has no OS URL handler.
    takePendingDeepLinkNav: async () => null,

    // Inline AI — canned intent classification + streamed generations + a
    // deterministic edit rewrite, so the whole AI menu is drivable.
    generateInlineAi: async ({ prompt, requestId }) => {
      const edited = cannedEditResponse(prompt);
      // Edit prompts return the rewritten markdown whole (the renderer
      // diffs it into suggestions); generate prompts stream deltas.
      if (edited !== null) {
        return new Promise((resolve) => setTimeout(() => resolve({ ok: true, text: edited }), 400));
      }
      // Multi-block markdown so the incremental streaming parse is
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

    // Executor — reports running (fake callback origin) so the connectors
    // grid + dialogs render and are drivable in the harness; there's no
    // daemon, so the read lists are empty and every mutating flow rejects
    // loudly (the dialogs/cards surface the message).
    executorStatus: async () => ({
      running: true,
      redirectUri: "http://127.0.0.1:47888/oauth/callback",
    }),
    listExecutorIntegrations: async () => [],
    detectExecutorIntegration: async () => [],
    listExecutorConnections: async () => [],
    createExecutorOAuthClient: async () => {
      throw unavailable("executor");
    },
    ensureGoogleOAuthClient: async () => ({ status: "unavailable" }),
    // Host-orchestrated install/uninstall (register integration → mint
    // connection → browser OAuth server-side).
    installConnector: async () => {
      throw unavailable("executor");
    },
    uninstallConnector: async () => {
      throw unavailable("executor");
    },
    // Dev-only emulate seam — no daemon, no OAuth flow in the harness.
    getPendingConnectorAuth: async () => {
      throw unavailable("executor");
    },

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
    // Sign-up = sign-in in the harness (no real user table): the section's
    // create-account flow lands signed in, like the host's signUp does.
    syncSignUp: async ({ email }) => {
      syncState = { ...syncState, signedIn: true, email };
      emitSync();
      return { ok: true };
    },
    // Host parity: initiation returns ok (browser opened) with no state
    // change; the harness then plays the browser+deep-link leg itself — a
    // short beat later the "user" completes consent, the session is adopted,
    // and onSocialSignInResult resolves the pending UI. Keeps the account
    // section's full social flow drivable with no real OAuth.
    syncSocialSignIn: async ({ provider }) => {
      setTimeout(() => {
        syncState = { ...syncState, signedIn: true, email: `${provider}-user@example.com` };
        emitSync();
        socialResultEvents.emit({ ok: true });
      }, 800);
      return { ok: true };
    },
    // Neutral by CONTRACT (see the registry entry): the real coordinator
    // answers identically whether or not the email has an account, so an
    // unconditional `ok` IS host parity — the section's "if that email has an
    // account…" confirmation is drivable for any input.
    syncRequestPasswordReset: async () => ({ ok: true }),
    // Both providers listed so the Account section's social buttons render and
    // are drivable in the harness.
    getAccountCapabilities: async () => ({ socialProviders: ["github", "google"] }),
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
      // Simulate a pass that hit two conflicts: write real conflict-copy files
      // into the fixture vault (host naming) so the Settings conflict list's
      // Open and Dismiss actions are exercisable end-to-end in the harness.
      const copies = [
        conflictCopyName("welcome.md", fsSafeStamp(new Date())),
        conflictCopyName("tasks.md", fsSafeStamp(new Date(Date.now() + 1000))),
      ];
      for (const [i, copyPath] of copies.entries()) {
        if (vault.has(copyPath)) continue;
        vault.set(
          copyPath,
          `# Conflict copy ${i + 1}\n\nThe losing side of a simulated conflict.\n`,
        );
        indexEntry(copyPath);
      }
      touchVault();
      const conflicts = [
        ...syncState.conflicts,
        ...copies
          .filter((path) => !syncState.conflicts.some((conflict) => conflict.path === path))
          .map((path) => ({ path })),
      ];
      const outcome = {
        status: "ok",
        pushed: 2,
        pulled: 1,
        deleted: 0,
        conflicts: copies.length,
        merged: 1,
        conflictPaths: copies,
      } as const;
      syncState = { ...syncState, status: { ...outcome, phase: "ok" }, conflicts };
      emitSync();
      return outcome;
    },
    onSyncStateChanged: syncEvents.subscribe,
    onSocialSignInResult: socialResultEvents.subscribe,

    // Remote access — simulated ws-server state so the settings section is
    // drivable: toggling flips listening + LAN URLs, pairing returns a fixed
    // token, revoking drops the pre-paired fixture device.
    getRemoteAccessState: async () => remoteAccessState,
    setRemoteAccessConfig: async (patch) => {
      const enabled = patch.enabled ?? remoteAccessState.enabled;
      remoteAccessState = {
        ...remoteAccessState,
        enabled,
        listening: enabled,
        lanUrls: enabled ? [`ws://192.168.1.24:${remoteAccessState.port}`] : [],
      };
      emitRemoteAccess();
      return remoteAccessState;
    },
    createPairingToken: async () => ({
      token: "fixture-pairing-token",
      urls: ["ws://127.0.0.1:47890"],
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }),
    revokeRemoteDevice: async ({ id }) => {
      remoteAccessState = {
        ...remoteAccessState,
        devices: remoteAccessState.devices.filter((device) => device.id !== id),
      };
      emitRemoteAccess();
      return remoteAccessState;
    },
    onRemoteAccessChanged: remoteAccessEvents.subscribe,

    // Skills / integrations — one seeded row each so the Settings panels
    // render their POPULATED state ("zero installed" is a legitimate state,
    // but the harness should demo rows). Repair mutates real binaries on the
    // host, so it rejects loudly instead of pretending to succeed.
    listSkills: async () => ({
      skills: [
        {
          name: "summarize-note",
          description: "Summarize the open note into a short digest (dev-harness fixture).",
          scope: "user",
          filePath: "/fixture/.inteligir/skills/summarize-note/SKILL.md",
        },
      ],
    }),
    listIntegrations: async () => [{ name: "fixture-cli", expected: "1.2.3", installed: "1.2.3" }],
    repairIntegrations: async () => {
      throw unavailable("integrations repair");
    },
  };
}
