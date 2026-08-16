// An in-process server implementing the SAME contract table the product
// registers (typedRoutes over apiRoutes — the handlers compile against the
// rows, so this fixture cannot drift from the wire contract) over in-memory
// state. What it deliberately is NOT: the product's composition — the real
// server behind the CLI is exercised by the e2e cli-drive scenario; these
// suites pin what the CLI itself owns (rendering, flags, exit codes).

import { serve } from "@hono/node-server";
import type {
  AgentStatus,
  ApiErrorResponse,
  SystemStatusResponse,
} from "@repo/server-contract/routes";
import { apiRoutes, API_BASE_PATH } from "@repo/server-contract/routes";
import type {
  BacklinkEntryWire,
  SearchResultWire,
  TagCountWire,
} from "@repo/server-contract/knowledge";
import type { PendingInteraction, Thread } from "@repo/server-contract/threads";
import type { ThreadTimeline } from "@repo/server-contract/thread-timeline";
import type { VaultEntry, VaultStatusResponse } from "@repo/server-contract/vault";
import type { ThreadStatus } from "@repo/domain/thread-status";
import { typedRoutes } from "@repo/typed-routes/typed-routes";
import { Hono } from "hono";

const NOT_FOUND: ApiErrorResponse = { error: "not_found", message: "Not found" };

interface FixtureThread {
  thread: Thread;
  pendingInteractions: PendingInteraction[];
  timeline: ThreadTimeline;
  /** Each /threads/get consumes one entry; the last one sticks. */
  statusSequence?: ThreadStatus[];
}

export interface FixtureState {
  vault: Map<string, string>;
  searchResults: SearchResultWire[];
  tags: TagCountWire[];
  backlinks: BacklinkEntryWire[];
  threads: FixtureThread[];
  guideMarkdown: string;
  agent: AgentStatus;
  vaultStatus: VaultStatusResponse;
  nextCreatedThreadId: string;
}

export const EMPTY_TIMELINE: ThreadTimeline = { rows: [], maxSequence: 0, tokenUsage: null };

export function makeThread(overrides: Partial<Thread> & Pick<Thread, "id">): Thread {
  return {
    title: null,
    status: "idle",
    activeTurnId: null,
    originDocPath: null,
    originAnchor: null,
    archivedAt: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

export function makeFixtureState(): FixtureState {
  return {
    vault: new Map(),
    searchResults: [],
    tags: [],
    backlinks: [],
    threads: [],
    guideMarkdown: "# Fixture guide\n\nBe kind to the vault.\n",
    agent: { mode: "auto", runtime: "codex", detail: null },
    vaultStatus: { state: "no-remote", lastSyncAt: null, lastError: null },
    nextCreatedThreadId: "thr_created_1",
  };
}

/** Dirs derived from the file paths: every ancestor, sorted, then files. */
function deriveTree(vault: Map<string, string>): VaultEntry[] {
  const dirs = new Set<string>();
  for (const path of vault.keys()) {
    const segments = path.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      dirs.add(segments.slice(0, depth).join("/"));
    }
  }
  const dirEntries: VaultEntry[] = [...dirs].toSorted().map((path) => ({ kind: "dir", path }));
  const fileEntries: VaultEntry[] = [...vault.keys()].toSorted().map((path) => ({
    kind: "file",
    path,
    size: vault.get(path)?.length ?? 0,
  }));
  return [...dirEntries, ...fileEntries];
}

function findThread(state: FixtureState, threadId: string): FixtureThread | undefined {
  return state.threads.find((entry) => entry.thread.id === threadId);
}

function createFixtureApp(state: FixtureState): Hono {
  const api = new Hono();
  const { get, post, put } = typedRoutes(api);

  get(apiRoutes.health, (c) => c.json({ ok: true }));
  get(apiRoutes.system.status, (c) => {
    const status: SystemStatusResponse = {
      version: "9.9.9-fixture",
      dataDir: "/fixture/data",
      schemaVersion: 3,
      uptimeMs: 65_000,
      agent: state.agent,
    };
    return c.json(status);
  });
  get(apiRoutes.guide, (c) => c.json({ markdown: state.guideMarkdown }));

  get(apiRoutes.vault.tree, (c) =>
    c.json({ root: "/fixture/vault", entries: deriveTree(state.vault) }),
  );
  get(apiRoutes.vault.read, (c, query) => {
    const content = state.vault.get(query.path);
    if (content === undefined) {
      return c.json({ error: "not_found", message: `No file at ${query.path}` }, 404);
    }
    return c.json({ path: query.path, content });
  });
  put(apiRoutes.vault.write, (c, body) => {
    state.vault.set(body.path, body.content);
    return c.json({ path: body.path });
  });
  post(apiRoutes.vault.rename, (c, body) => {
    const content = state.vault.get(body.from);
    if (content === undefined) {
      return c.json({ error: "not_found", message: `No file at ${body.from}` }, 404);
    }
    state.vault.delete(body.from);
    state.vault.set(body.to, content);
    return c.json({ path: body.to, rewritten: [], skipped: [] });
  });
  post(apiRoutes.vault.remove, (c, body) => {
    if (!state.vault.delete(body.path)) {
      return c.json({ error: "not_found", message: `No file at ${body.path}` }, 404);
    }
    return c.json({ ok: true });
  });
  post(apiRoutes.vault.mkdir, (c, body) => c.json({ path: body.path }));
  get(apiRoutes.vault.status, (c) => c.json(state.vaultStatus));
  post(apiRoutes.vault.syncNow, (c) => c.json(state.vaultStatus));

  get(apiRoutes.knowledge.search, (c, query) =>
    c.json({ results: query.q.length === 0 ? [] : state.searchResults }),
  );
  get(apiRoutes.knowledge.backlinks, (c, query) =>
    c.json({ path: query.path, backlinks: state.backlinks, total: state.backlinks.length }),
  );
  get(apiRoutes.knowledge.tags, (c) => c.json({ tags: state.tags, total: state.tags.length }));
  get(apiRoutes.knowledge.renameCandidates, (c) => c.json({ candidates: [], total: 0 }));

  get(apiRoutes.threads.list, (c) =>
    c.json({ threads: state.threads.map((entry) => entry.thread) }),
  );
  get(apiRoutes.threads.get, (c, query) => {
    const entry = findThread(state, query.threadId);
    if (entry === undefined) {
      return c.json(NOT_FOUND, 404);
    }
    const nextStatus = entry.statusSequence?.shift();
    if (nextStatus !== undefined) {
      entry.thread = { ...entry.thread, status: nextStatus };
    }
    return c.json({ thread: entry.thread, pendingInteractions: entry.pendingInteractions });
  });
  post(apiRoutes.threads.create, (c, body) => {
    const thread = makeThread({
      id: state.nextCreatedThreadId,
      originDocPath: body.originDocPath ?? null,
      originAnchor: body.originAnchor ?? null,
      ...(body.title !== undefined ? { title: body.title } : {}),
    });
    state.threads.push({ thread, pendingInteractions: [], timeline: EMPTY_TIMELINE });
    return c.json({ thread }, 201);
  });
  post(apiRoutes.threads.archive, (c, body) => {
    const entry = findThread(state, body.threadId);
    if (entry === undefined) {
      return c.json(NOT_FOUND, 404);
    }
    entry.thread = { ...entry.thread, archivedAt: 1_700_000_001_000 };
    return c.json({ thread: entry.thread });
  });
  post(apiRoutes.threads.send, (c, body) => {
    const entry = findThread(state, body.threadId);
    if (entry === undefined) {
      return c.json(NOT_FOUND, 404);
    }
    return c.json({ kind: "started", turnId: `turn_for_${body.threadId}` });
  });
  get(apiRoutes.threads.timeline, (c, query) => {
    const entry = findThread(state, query.threadId);
    if (entry === undefined) {
      return c.json(NOT_FOUND, 404);
    }
    return c.json({ kind: "full", timeline: entry.timeline });
  });
  post(apiRoutes.threads.answerInteraction, (c, body) => {
    const entry = findThread(state, body.threadId);
    const interaction = entry?.pendingInteractions.find((row) => row.id === body.interactionId);
    if (entry === undefined || interaction === undefined) {
      return c.json({ error: "not_found", message: "Interaction not found" }, 404);
    }
    const resolved: PendingInteraction = {
      ...interaction,
      status: "resolved",
      resolution: body.resolution,
      resolvedAt: 1_700_000_002_000,
    };
    entry.pendingInteractions = entry.pendingInteractions.map((row) =>
      row.id === resolved.id ? resolved : row,
    );
    return c.json({ interaction: resolved });
  });

  const app = new Hono();
  app.route(API_BASE_PATH, api);
  return app;
}

export interface FixtureServer {
  baseUrl: string;
  close(): Promise<void>;
}

export async function serveFixture(state: FixtureState): Promise<FixtureServer> {
  const app = createFixtureApp(state);
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      resolve({
        baseUrl: `http://127.0.0.1:${info.port}`,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          }),
      });
    });
  });
}
