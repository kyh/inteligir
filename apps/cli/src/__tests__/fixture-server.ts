// An in-process server implementing the SAME contract table the product
// registers (typedRoutes over apiRoutes — the handlers compile against the
// rows, so this fixture cannot drift from the wire contract) over in-memory
// state. What it deliberately is NOT: the product's composition — the real
// server behind the CLI is exercised by the e2e cli-drive scenario; these
// suites pin what the CLI itself owns (rendering, flags, exit codes).

import { serve } from "@hono/node-server";
import type { CloudStatusResponse } from "@repo/server-contract/cloud";
import type { ConnectorsResponse } from "@repo/server-contract/connectors";
import type { ConnectedFoldersResponse } from "@repo/server-contract/folders";
import type { ApiErrorCode, ApiErrorResponse } from "@repo/server-contract/errors";
import type { AgentStatus, SystemStatusResponse } from "@repo/server-contract/routes";
import { apiRoutes, API_BASE_PATH } from "@repo/server-contract/routes";
import type {
  BacklinkEntryWire,
  RelatedNoteWire,
  SearchResultWire,
  TagCountWire,
} from "@repo/server-contract/knowledge";
import type { CommentThreadWire } from "@repo/server-contract/comments";
import type { Proposal } from "@repo/server-contract/proposals";
import type {
  PendingInteraction,
  QueuedThreadMessage,
  Thread,
} from "@repo/server-contract/threads";
import type { ThreadTimeline } from "@repo/server-contract/thread-timeline";
import type { VaultEntry, VaultStatusResponse } from "@repo/server-contract/vault";
import type { ThreadStatus } from "@repo/domain/thread-status";
import { typedRoutes } from "@repo/typed-routes/typed-routes";
import { Hono } from "hono";

const NOT_FOUND: ApiErrorResponse = { error: "not_found", message: "Not found" };

const FIXTURE_CLOUD_URL = "https://cloud.fixture";

export interface FixtureThread {
  thread: Thread;
  pendingInteractions: PendingInteraction[];
  /** Optional: most fixtures never queue, and the response defaults it. */
  queuedMessages?: QueuedThreadMessage[];
  timeline: ThreadTimeline;
  /** Each /threads/get consumes one entry; the last one sticks. */
  statusSequence?: ThreadStatus[];
}

export interface FixtureState {
  /** The instance identity discovery compares against. */
  dataDir: string;
  /** When set, EVERY api route answers this instead — the fitness test's
   *  "does each leaf check the status?" lever. */
  failWith: { status: 400 | 500; error: ApiErrorCode; message: string } | null;
  /** Refuse only /threads/send — the window `thread new` must not orphan in. */
  refuseSend: { error: ApiErrorCode; message: string } | null;
  vault: Map<string, string>;
  searchResults: SearchResultWire[];
  tags: TagCountWire[];
  backlinks: BacklinkEntryWire[];
  related: RelatedNoteWire[];
  connectors: ConnectorsResponse;
  folders: ConnectedFoldersResponse;
  cloud: CloudStatusResponse;
  threads: FixtureThread[];
  proposals: Proposal[];
  /** Comment threads per note path, in the wire shape the routes answer. */
  comments: Map<string, CommentThreadWire[]>;
  guideMarkdown: string;
  agent: AgentStatus;
  vaultStatus: VaultStatusResponse;
  nextCreatedThreadId: string;
}

export const EMPTY_TIMELINE: ThreadTimeline = { rows: [], maxSequence: 0, tokenUsage: null };

export function makeProposal(overrides: Partial<Proposal> & Pick<Proposal, "id">): Proposal {
  return {
    threadId: "thr_1",
    turnId: "turn_1",
    docPath: "notes/hello.md",
    status: "pending",
    revision: 1,
    baseHash: "a".repeat(64),
    baseContent: "# Hello\n",
    proposedContent: "# Hello there\n",
    hunks: [
      {
        index: 0,
        baseStart: 0,
        baseEnd: 1,
        baseLines: ["# Hello"],
        proposedLines: ["# Hello there"],
      },
    ],
    acceptedHunks: 0,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    resolvedAt: null,
    ...overrides,
  };
}

export function makeThread(overrides: Partial<Thread> & Pick<Thread, "id">): Thread {
  return {
    title: null,
    status: "idle",
    activeTurnId: null,
    originDocPath: null,
    originAnchor: null,
    providerId: null,
    writeMode: "direct",
    archivedAt: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

export function makeFixtureState(): FixtureState {
  return {
    dataDir: "/fixture/data",
    failWith: null,
    refuseSend: null,
    vault: new Map(),
    searchResults: [],
    tags: [],
    backlinks: [],
    related: [],
    connectors: { servers: [] },
    folders: { folders: [] },
    cloud: { state: "off", cloudUrl: FIXTURE_CLOUD_URL },
    threads: [],
    proposals: [],
    comments: new Map(),
    guideMarkdown: "# Fixture guide\n\nBe kind to the vault.\n",
    agent: { mode: "auto", runtime: "acp", detail: null },
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
  }));
  return [...dirEntries, ...fileEntries];
}

function findThread(state: FixtureState, threadId: string): FixtureThread | undefined {
  return state.threads.find((entry) => entry.thread.id === threadId);
}

/** The two review verbs, as far as the CLI can tell them apart: the revision
 *  guard and the settled row. The real arithmetic lives in the app's own
 *  service and is tested there. Answers a DESCRIPTION rather than a Response,
 *  because the typed json() is a union of (body, status) tuples that a shared
 *  helper cannot satisfy — the handler picks the arm. */
function resolveFixtureProposal(
  state: FixtureState,
  body: { proposalId: string; expectedRevision: number },
  status: "accepted" | "rejected",
): { ok: true; proposal: Proposal } | { ok: false; status: 404 | 409; body: ApiErrorResponse } {
  const existing = state.proposals.find((row) => row.id === body.proposalId);
  if (existing === undefined) {
    return {
      ok: false,
      status: 404,
      body: { error: "not_found", message: "Suggestion not found" },
    };
  }
  if (existing.revision !== body.expectedRevision) {
    return {
      ok: false,
      status: 409,
      body: { error: "conflict", message: "This suggestion moved on" },
    };
  }
  const resolved: Proposal = {
    ...existing,
    status,
    revision: existing.revision + 1,
    hunks: [],
    resolvedAt: 1_700_000_003_000,
  };
  state.proposals = state.proposals.map((row) => (row.id === resolved.id ? resolved : row));
  return { ok: true, proposal: resolved };
}

function createFixtureApp(state: FixtureState): Hono {
  const api = new Hono();
  // Flipped by a test to make every route refuse: what proves a command
  // CHECKS the status rather than printing whatever body arrives.
  api.use("*", async (c, next) => {
    const failure = state.failWith;
    if (failure === null) {
      await next();
      return undefined;
    }
    return c.json({ error: failure.error, message: failure.message }, failure.status);
  });
  const { get, post, put } = typedRoutes(api);

  get(apiRoutes.health, (c) => c.json({ ok: true }));
  get(apiRoutes.system.status, (c) => {
    const status: SystemStatusResponse = {
      version: "9.9.9-fixture",
      dataDir: state.dataDir,
      vaultDir: "/fixture/vault",
      schemaVersion: 3,
      uptimeMs: 65_000,
      agent: state.agent,
    };
    return c.json(status);
  });
  get(apiRoutes.guide, (c) => c.json({ markdown: state.guideMarkdown }));

  get(apiRoutes.vault.tree, (c) =>
    c.json({ root: "/fixture/vault", name: "vault", entries: deriveTree(state.vault) }),
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
  get(apiRoutes.vault.trashList, (c) =>
    c.json({
      entries: [...state.vault.keys()]
        .filter((path) => path.startsWith("Trash/") && path.endsWith(".md"))
        .map((path) => ({ path, trashedAt: null, trashedFrom: null })),
    }),
  );
  post(apiRoutes.vault.trash, (c, body) => {
    const content = state.vault.get(body.path);
    if (content === undefined) {
      return c.json({ error: "not_found", message: `No file at ${body.path}` }, 404);
    }
    state.vault.delete(body.path);
    const target = `Trash/${body.path}`;
    state.vault.set(target, content);
    return c.json({ path: target });
  });
  post(apiRoutes.vault.trashRestore, (c, body) => {
    const content = state.vault.get(body.path);
    if (content === undefined) {
      return c.json({ error: "not_found", message: `No file at ${body.path}` }, 404);
    }
    state.vault.delete(body.path);
    const target = body.path.replace(/^Trash\//, "");
    state.vault.set(target, content);
    return c.json({ path: target });
  });
  post(apiRoutes.vault.trashPurge, (c, body) => {
    if (!state.vault.delete(body.path)) {
      return c.json({ error: "not_found", message: `No file at ${body.path}` }, 404);
    }
    return c.json({ ok: true });
  });
  post(apiRoutes.vault.importMoss, (c, body) =>
    c.json({
      dryRun: body.dryRun,
      scanned: 2,
      changed: 1,
      files: [
        {
          path: "notes/hello.md",
          bodyChanged: true,
          sidecarChanged: false,
          notes: ["1 legacy comment range(s) modernized"],
        },
      ],
      warnings: [],
    }),
  );
  get(apiRoutes.vault.status, (c) => c.json(state.vaultStatus));
  post(apiRoutes.vault.syncNow, (c) => c.json(state.vaultStatus));

  get(apiRoutes.knowledge.search, (c, query) =>
    c.json({ results: query.q.length === 0 ? [] : state.searchResults }),
  );
  get(apiRoutes.knowledge.backlinks, (c, query) =>
    c.json({ path: query.path, backlinks: state.backlinks, total: state.backlinks.length }),
  );
  get(apiRoutes.knowledge.related, (c, query) =>
    c.json({ path: query.path, related: state.related.slice(0, query.limit) }),
  );
  get(apiRoutes.knowledge.tags, (c) => c.json({ tags: state.tags, total: state.tags.length }));
  get(apiRoutes.knowledge.renameCandidates, (c) => c.json({ candidates: [], total: 0 }));

  const commentsBody = (path: string) => {
    const threads = state.comments.get(path) ?? [];
    return { path, threads, total: threads.length, orphanMarkers: [], strayIds: [] };
  };
  get(apiRoutes.comments.list, (c, query) => c.json(commentsBody(query.path)));
  post(apiRoutes.comments.add, (c, body) => {
    const threads = state.comments.get(body.path) ?? [];
    threads.push({
      anchored: false,
      replies: [],
      resolved: false,
      root: { createdAt: 1, source: "user", text: body.text, updatedAt: 1 },
      rootId: body.id,
    });
    state.comments.set(body.path, threads);
    return c.json(commentsBody(body.path));
  });
  post(apiRoutes.comments.reply, (c, body) => {
    const threads = state.comments.get(body.path) ?? [];
    const thread = threads.find((row) => row.rootId === body.parentId);
    if (thread === undefined) {
      return c.json({ error: "not_found", message: `no thread ${body.parentId}` }, 404);
    }
    thread.replies.push({
      entry: { createdAt: 2, source: "user", text: body.text, updatedAt: 2 },
      id: body.id,
    });
    return c.json(commentsBody(body.path));
  });
  post(apiRoutes.comments.resolve, (c, body) => {
    const thread = (state.comments.get(body.path) ?? []).find((row) => row.rootId === body.id);
    if (thread === undefined) {
      return c.json({ error: "not_found", message: `no thread ${body.id}` }, 404);
    }
    thread.resolved = body.resolved;
    return c.json(commentsBody(body.path));
  });
  post(apiRoutes.comments.remove, (c, body) => {
    const threads = state.comments.get(body.path) ?? [];
    const remaining = threads.filter((row) => row.rootId !== body.id);
    if (remaining.length === threads.length) {
      return c.json({ error: "not_found", message: `no thread ${body.id}` }, 404);
    }
    state.comments.set(body.path, remaining);
    return c.json({ ...commentsBody(body.path), removedIds: [body.id] });
  });

  get(apiRoutes.folders.list, (c) => c.json(state.folders));
  post(apiRoutes.folders.add, (c, body) => {
    if (state.folders.folders.includes(body.path)) {
      return c.json({ error: "already_exists", message: `"${body.path}" is connected` }, 409);
    }
    state.folders.folders.push(body.path);
    return c.json(state.folders);
  });
  post(apiRoutes.folders.remove, (c, body) => {
    const before = state.folders.folders.length;
    state.folders.folders = state.folders.folders.filter((row) => row !== body.path);
    if (state.folders.folders.length === before) {
      return c.json({ error: "not_found", message: `not connected: ${body.path}` }, 404);
    }
    return c.json(state.folders);
  });

  get(apiRoutes.connectors.list, (c) => c.json(state.connectors));
  post(apiRoutes.connectors.add, (c, body) => {
    if (state.connectors.servers.some((row) => row.name === body.name)) {
      return c.json({ error: "already_exists", message: `"${body.name}" exists` }, 409);
    }
    state.connectors.servers.push({
      enabled: true,
      name: body.name,
      transport:
        body.transport.kind === "stdio"
          ? { args: body.transport.args, command: body.transport.command, kind: "stdio" }
          : body.transport.kind === "oauth"
            ? {
                authorizationEndpoint: body.transport.authorizationEndpoint,
                clientId: body.transport.clientId,
                kind: "oauth",
                scopes: body.transport.scopes,
                status: "needs-auth",
                tokenEndpoint: body.transport.tokenEndpoint,
                url: body.transport.url,
              }
            : {
                hasAuth: Object.keys(body.transport.headers ?? {}).length > 0,
                kind: "http",
                url: body.transport.url,
              },
    });
    return c.json(state.connectors);
  });
  post(apiRoutes.connectors.remove, (c, body) => {
    const before = state.connectors.servers.length;
    state.connectors.servers = state.connectors.servers.filter((row) => row.name !== body.name);
    if (state.connectors.servers.length === before) {
      return c.json({ error: "not_found", message: `no connector ${body.name}` }, 404);
    }
    return c.json(state.connectors);
  });
  post(apiRoutes.connectors.update, (c, body) => {
    const row = state.connectors.servers.find((candidate) => candidate.name === body.name);
    if (row === undefined) {
      return c.json({ error: "not_found", message: `no connector ${body.name}` }, 404);
    }
    return c.json(state.connectors);
  });
  post(apiRoutes.connectors.toggle, (c, body) => {
    const row = state.connectors.servers.find((candidate) => candidate.name === body.name);
    if (row === undefined) {
      return c.json({ error: "not_found", message: `no connector ${body.name}` }, 404);
    }
    row.enabled = body.enabled;
    return c.json(state.connectors);
  });

  get(apiRoutes.cloud.status, (c) => c.json(state.cloud));
  // The real route opens a browser; this one never can, so `opened` mirrors
  // what was ASKED — which is what the CLI's own claim ("opened your browser"
  // vs "approve here") is derived from.
  post(apiRoutes.cloud.pairBegin, (c, body) =>
    c.json({
      url: `${FIXTURE_CLOUD_URL}/app/pair?redirect=http%3A%2F%2F127.0.0.1%3A4664%2Fpair%2Fcallback&state=${"0".repeat(32)}&name=fixture`,
      opened: body.openBrowser,
      deviceName: body.deviceName ?? "fixture-host",
      expiresInMs: 600_000,
    }),
  );
  post(apiRoutes.cloud.unpair, (c) => {
    state.cloud = { state: "off", cloudUrl: FIXTURE_CLOUD_URL };
    return c.json(state.cloud);
  });
  post(apiRoutes.cloud.syncNow, (c) => c.json(state.cloud));

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
    return c.json({
      thread: entry.thread,
      pendingInteractions: entry.pendingInteractions,
      queuedMessages: entry.queuedMessages ?? [],
    });
  });
  post(apiRoutes.threads.create, (c, body) => {
    const overrides: Partial<Thread> & Pick<Thread, "id"> = {
      id: state.nextCreatedThreadId,
      originDocPath: body.originDocPath ?? null,
      originAnchor: body.originAnchor ?? null,
    };
    if (body.title !== undefined) {
      overrides.title = body.title;
    }
    const thread = makeThread(overrides);
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
    const refusal = state.refuseSend;
    if (refusal !== null) {
      return c.json({ error: refusal.error, message: refusal.message }, 503);
    }
    return c.json({ kind: "started", turnId: `turn_for_${body.threadId}` });
  });
  get(apiRoutes.threads.listInteractions, (c, query) =>
    c.json({
      interactions: state.threads
        .filter((entry) => query.threadId === undefined || entry.thread.id === query.threadId)
        .flatMap((entry) => entry.pendingInteractions),
    }),
  );
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

  get(apiRoutes.proposals.list, (c, query) =>
    c.json({
      proposals: state.proposals.filter(
        (proposal) =>
          (query?.docPath === undefined || proposal.docPath === query.docPath) &&
          (query?.threadId === undefined || proposal.threadId === query.threadId) &&
          (query?.includeResolved === true || proposal.status !== "accepted"),
      ),
    }),
  );
  get(apiRoutes.proposals.get, (c, query) => {
    const proposal = state.proposals.find((row) => row.id === query.proposalId);
    if (proposal === undefined) {
      return c.json({ error: "not_found", message: "Suggestion not found" }, 404);
    }
    return c.json({ proposal });
  });
  post(apiRoutes.proposals.accept, (c, body) => {
    const outcome = resolveFixtureProposal(state, body, "accepted");
    return outcome.ok
      ? c.json({ proposal: outcome.proposal })
      : c.json(outcome.body, outcome.status);
  });
  post(apiRoutes.proposals.reject, (c, body) => {
    const outcome = resolveFixtureProposal(state, body, "rejected");
    return outcome.ok
      ? c.json({ proposal: outcome.proposal })
      : c.json(outcome.body, outcome.status);
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
