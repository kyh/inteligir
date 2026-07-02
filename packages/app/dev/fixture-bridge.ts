// ---------------------------------------------------------------------------
// In-memory fixture Bridge for the browser dev harness. Fully typed against
// the real Bridge contract — when the IPC registry changes, this file fails
// typecheck. Vault reads/writes hit a Map seeded with sample notes; agent
// chat streams a canned reply; voice/executor/updates report unavailable.
// ---------------------------------------------------------------------------

import type { AppAgentEvent } from "@repo/core/agent-events";
import type { AppState } from "@repo/core/app-state";
import type { Delegation, ListDelegationsResult } from "@repo/core/delegation";
import type { Bridge, ChatHistoryEntry, UpdateState } from "@repo/core/ipc";
import type { VaultEntry } from "@repo/core/ipc-registry";

// Single source with the round-trip fixture matrix: the full-vocabulary sample
// note IS the canonical kitchen-sink fixture.
import kitchenSink from "../src/__tests__/fixtures/roundtrip/canonical/kitchen-sink.md?raw";

const FIXTURE_ROOT = "/fixture-vault";

// Exported for the legacy-corpus classification test: every sample note must
// hold its expected canonical/raw class as the pipeline evolves.
export const SAMPLE_NOTES: Record<string, string> = {
  // Sample notes are PRE-CANONICALIZED (pinned by the corpus test): a churn-y
  // note would reflow wholesale on its first edit, drowning the user's change
  // in formatting noise. Long paragraphs stay on one line (the alternative
  // canonical form is `\`-terminated hard-break lines).
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
`,
};

/** Streams `text` in small chunks via `onDelta`, then calls `onDone`. */
function streamText(text: string, onDelta: (delta: string) => void, onDone: () => void): void {
  const words = text.split(/(?<= )/);
  let i = 0;
  const tick = () => {
    const chunk = words.slice(i, i + 3).join("");
    i += 3;
    onDelta(chunk);
    if (i < words.length) setTimeout(tick, 40);
    else onDone();
  };
  setTimeout(tick, 120);
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

export function createFixtureBridge(): Bridge {
  const vault = new Map<string, string>(Object.entries(SAMPLE_NOTES));
  const uiState: Record<string, unknown> = {};
  const history: ChatHistoryEntry[] = [];
  const delegations: Delegation[] = [];
  let notifications = { enabled: false };
  let appState: AppState = { phase: "ready", agent: "idle" };

  const agentEvents = new Emitter<AppAgentEvent>();
  const appStateEvents = new Emitter<AppState>();
  const vaultEvents = new Emitter<{ root: string }>();
  const aiEvents = new Emitter<{ requestId: string; delta: string }>();
  const delegationEvents = new Emitter<ListDelegationsResult>();

  const setAppState = (next: AppState) => {
    appState = next;
    appStateEvents.emit(next);
  };

  const listEntries = (): VaultEntry[] =>
    [...vault.keys()].toSorted().map((path) => ({
      path,
      name: path.split("/").at(-1) ?? path,
      kind: /\.(md|markdown|txt)$/.test(path) ? "doc" : "other",
    }));

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

    // Voice — reports unavailable; the harness has no STT/TTS host.
    isTtsAvailable: async () => false,
    ttsSend: () => {},
    ttsFlush: () => {},
    ttsInterrupt: () => {},
    onTtsAudio: () => () => {},
    startStt: async () => ({ ok: false, reason: "voice is not available in the dev harness" }),
    sendSttAudio: () => {},
    stopStt: async () => [],
    onSttTranscript: () => () => {},
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
      vaultEvents.emit({ root: FIXTURE_ROOT });
    },
    deleteVaultEntry: async ({ path }) => {
      const removed = vault.delete(path);
      if (removed) vaultEvents.emit({ root: FIXTURE_ROOT });
      return { removed };
    },
    renameVaultEntry: async ({ from, to }) => {
      const content = vault.get(from);
      if (content === undefined) return { ok: false, error: `no such file: ${from}` };
      if (vault.has(to)) return { ok: false, error: `already exists: ${to}` };
      vault.delete(from);
      vault.set(to, content);
      vaultEvents.emit({ root: FIXTURE_ROOT });
      return { ok: true };
    },
    onVaultChanged: vaultEvents.subscribe,

    // Delegation — no background agent; created delegations fail immediately
    // so the inline badge + dock plumbing stays exercisable.
    createDelegation: async ({ sourceFile, index }) => {
      const now = Date.now();
      const delegation: Delegation = {
        id: `fixture-${now}-${index}`,
        sourceFile,
        anchor: { index, text: "", heading: null },
        lineText: "",
        status: "failed",
        createdAt: now,
        startedAt: null,
        finishedAt: now,
        resultSummary: null,
        error: "delegation is not available in the dev harness",
      };
      delegations.push(delegation);
      delegationEvents.emit({ delegations: [...delegations] });
      return { ok: true, delegation };
    },
    listDelegations: async () => ({ delegations: [...delegations] }),
    cancelDelegation: async () => ({ ok: false }),
    onDelegationsUpdated: delegationEvents.subscribe,
    onDelegationStreamed: () => () => {},

    // Inline AI — streams a canned generation so the editor flow is testable.
    generateInlineAi: async ({ prompt, requestId }) => {
      const text = `(canned inline-AI output for: ${prompt.slice(0, 60)}…)`;
      return new Promise((resolve) => {
        streamText(
          text,
          (delta) => aiEvents.emit({ requestId, delta }),
          () => resolve({ ok: true, text }),
        );
      });
    },
    onAiStreamed: aiEvents.subscribe,

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

    // Skills / integrations
    listSkills: async () => ({ skills: [] }),
    listIntegrations: async () => [],
    repairIntegrations: async () => {},
  };
}
