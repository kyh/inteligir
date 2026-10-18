import { createServer } from "node:http";
import { implement, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { localContract } from "@repo/contract/local";
import type { CloudStatusResponse } from "@repo/contract/local/cloud/cloud-schema";
import type { AnnotationWire } from "@repo/contract/local/annotations/annotations-schema";
import type { ConnectorsResponse } from "@repo/contract/local/connectors/connectors-schema";
import type { ConnectedFoldersResponse } from "@repo/contract/local/folders/folders-schema";
import type { ImportJob, ImportsPlanResponse } from "@repo/contract/local/imports/imports-schema";
import { fileTooLargeMessage } from "@repo/contract/local/items/items-schema";
import type {
  ItemFill,
  ItemRowWire,
  ItemSaveResponse,
} from "@repo/contract/local/items/items-schema";
import type {
  BacklinkEntryWire,
  KnowledgeItemPathsRequest,
  RelatedNoteWire,
  SearchResultWire,
  TagCountWire,
} from "@repo/contract/local/knowledge/knowledge-schema";
import {
  fileKindOf,
  ITEM_FILE_MAX_BYTES,
  UNSORTED_FOLDER,
  URL_ITEM_KINDS,
} from "@repo/notes/items/item-kind";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { itemNameFromTitle, itemStem } from "@repo/notes/items/item-name";
import { parseItemTime } from "@repo/notes/items/item-time";
import { cleanUrl, kindForUrl, siteMatches, urlHost, urlKey } from "@repo/notes/items/item-url";
import { tagInFamily } from "@repo/notes/knowledge/rename-tags";
import {
  isVaultMetadataPath,
  docStem,
  freePath,
  isDocPath,
  takenIgnoringCase,
} from "@repo/notes/knowledge/doc-file";
import { basenamePath, dirnamePath, extnamePath } from "@repo/notes/knowledge/vault-path";
import { collectVaultMatches } from "@repo/notes/knowledge/text-matches";
import { KnowledgeIndex } from "@repo/notes/knowledge/knowledge-index";
import { searchBodyOf } from "@repo/notes/knowledge/search-columns";
import type { AgentsStatusResponse } from "@repo/contract/local/agents/agents-schema";
import { RPC_PREFIX } from "@repo/contract/local/routes";
import type { AgentStatus, SystemStatusResponse } from "@repo/contract/local/system/system-schema";
import type { ThreadTimeline } from "@repo/contract/local/thread-timeline";
import type {
  PendingInteraction,
  QueuedThreadMessage,
  Thread,
  TurnChanges,
  UndoTurnResponse,
} from "@repo/contract/local/threads/threads-schema";
import { DEFAULT_ATTACHMENT_LOCATION } from "@repo/contract/local/vault/vault-schema";
import type {
  VaultEntry,
  VaultPrefsResponse,
  VaultRevision,
  VaultStatusResponse,
} from "@repo/contract/local/vault/vault-schema";
import type { ActionPreset } from "@repo/domain/action-preset";
import type { ThreadStatus } from "@repo/domain/thread-status";
import { boundAddressSchema } from "../server/test-support/bound-address";
import { guardRefusalError, judgeGuard } from "../server/vault/write-guard";

// required so a command that reaches the wire without the bearer fails rather than passes.
export const FIXTURE_SERVER_TOKEN = "fixture-server-token";

export const FIXTURE_HANDOFF_NONCE = "fixture-handoff";

const FIXTURE_MEDIA_TOKEN = "fixture-media-token";

// every item a save adds says it was saved then
const FIXTURE_SAVED = "2026-10-17T09:12:30Z";

const FIXTURE_CLOUD_URL = "https://cloud.fixture";

export interface FixtureThread {
  thread: Thread;
  pendingInteractions: PendingInteraction[];
  queuedMessages?: QueuedThreadMessage[];
  timeline: ThreadTimeline;
  // each threads.get consumes one entry; the last one sticks.
  statusSequence?: ThreadStatus[];
  turnChanges?: TurnChanges[];
  // what undoing any applied turn answers; absent, every path the turn changed is reverted.
  turnUndo?: UndoTurnResponse;
}

export interface FixtureState {
  dataDir: string;
  failWith: { code: "BAD_REQUEST" | "INTERNAL_SERVER_ERROR"; message: string } | null;
  refuseSend: { code: "PROVIDER_UNAVAILABLE"; message: string } | null;
  // every message threads.send took, in order
  sent: { preset: ActionPreset | null; text: string; threadId: string }[];
  // false: the server of an unbuilt checkout, which mints no browser handoff.
  servesUi: boolean;
  vault: Map<string, string>;
  // every commitNow and landed write, in order, so a composition's ordering is assertable.
  vaultLog: string[];
  // bytes another writer lands just after the next read of that path is answered: the race a
  // guarded write exists to refuse.
  concurrentWrite: { path: string; content: string } | null;
  // newest first.
  revisions: Map<string, { revision: VaultRevision; content: string }[]>;
  searchResults: SearchResultWire[];
  tags: TagCountWire[];
  backlinks: BacklinkEntryWire[];
  related: RelatedNoteWire[];
  folders: ConnectedFoldersResponse;
  cloud: CloudStatusResponse;
  threads: FixtureThread[];
  annotations: Map<string, AnnotationWire[]>;
  // the library listing's rows, filtered and paged by the knowledge item handlers as the index's;
  // a save appends one, pending
  items: ItemRowWire[];
  // the latest import job, which imports.status answers
  importJob: ImportJob | null;
  // what imports.plan answers; null, the file reads as no export at all
  importPlan: ImportsPlanResponse | null;
  // the sentence a started job ends failed with; null, it ends done
  importFailure: string | null;
  guideMarkdown: string;
  agent: AgentStatus;
  vaultStatus: VaultStatusResponse;
  vaultPrefs: VaultPrefsResponse;
  nextCreatedThreadId: string;
}

export const EMPTY_TIMELINE: ThreadTimeline = { maxSequence: 0, rows: [] };

export const makeThread = (overrides: Partial<Thread> & Pick<Thread, "id">): Thread => ({
  activeTurnId: null,
  archivedAt: null,
  createdAt: 1_700_000_000_000,
  originDocPath: null,
  providerId: null,
  runsElsewhere: false,
  status: "idle",
  title: null,
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

export const makeInteraction = (
  overrides: Partial<PendingInteraction> & Pick<PendingInteraction, "id" | "threadId">,
): PendingInteraction => ({
  createdAt: 1_700_000_000_000,
  decision: null,
  payload: null,
  requestKey: `req_${overrides.id}`,
  resolvedAt: null,
  status: "pending",
  turnId: "turn_1",
  ...overrides,
});

export const FIXTURE_REVISION_SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";

export const makeRevision = (
  overrides: Partial<VaultRevision> & Pick<VaultRevision, "sha">,
): VaultRevision => ({
  authorEmail: "vault@inteligir.local",
  authorKind: "app",
  authorName: "inteligir",
  authoredAt: "2026-08-01T10:00:00+00:00",
  path: "notes/hello.md",
  subject: "vault: update notes/hello.md",
  ...overrides,
});

export const makeFixtureState = (): FixtureState => ({
  agent: { mode: "acp", runtime: "ready" },
  annotations: new Map(),
  backlinks: [],
  cloud: { cloudUrl: FIXTURE_CLOUD_URL, revokeError: null, state: "signed-out" },
  concurrentWrite: null,
  dataDir: "/fixture/data",
  failWith: null,
  folders: { folders: [] },
  guideMarkdown: "# Fixture guide\n\nBe kind to the vault.\n",
  importFailure: null,
  importJob: null,
  importPlan: null,
  items: [],
  nextCreatedThreadId: "thr_created_1",
  refuseSend: null,
  sent: [],
  related: [],
  revisions: new Map(),
  searchResults: [],
  servesUi: true,
  tags: [],
  threads: [],
  vault: new Map(),
  vaultLog: [],
  vaultPrefs: { attachments: DEFAULT_ATTACHMENT_LOCATION },
  vaultStatus: {
    conflicts: [],
    device: "Fixture Mac",
    externalSync: null,
    lastError: null,
    lastSyncAt: null,
    tooLarge: { count: 0, files: [] },
    state: "no-remote",
  },
});

const deriveTree = (vault: Map<string, string>): VaultEntry[] => {
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
};

const findThread = (state: FixtureState, threadId: string): FixtureThread | undefined =>
  state.threads.find((entry) => entry.thread.id === threadId);

const annotationsBody = (state: FixtureState, path: string) => {
  const annotations = state.annotations.get(path) ?? [];
  return { annotations, orphanMarkers: [], path, strayIds: [], total: annotations.length };
};

const base = implement(localContract).$context<FixtureState>();

const FIXTURE_AGENTS: AgentsStatusResponse = {
  defaultId: "claude",
  harnesses: [],
  signingIn: null,
};

// no verb signs an agent in or out; the contract asks every server to answer those rows
const agentsRouter = {
  cancelSignIn: base.agents.cancelSignIn.handler(() => FIXTURE_AGENTS),
  setDefault: base.agents.setDefault.handler(({ input }) => ({
    ...FIXTURE_AGENTS,
    defaultId: input.id,
  })),
  signIn: base.agents.signIn.handler(() => ({ outcome: "cancelled", status: FIXTURE_AGENTS })),
  signOut: base.agents.signOut.handler(() => ({ outcome: "signed-out", status: FIXTURE_AGENTS })),
  status: base.agents.status.handler(() => FIXTURE_AGENTS),
  submitSignInCode: base.agents.submitSignInCode.handler(() => ({ outcome: "sent" })),
};

const cloudRouter = {
  login: base.cloud.login.handler(({ context, input }) => {
    context.cloud = {
      accountEmail: input.email,
      cloudUrl: FIXTURE_CLOUD_URL,
      connected: false,
      cursor: 0,
      deviceId: `dev_${input.deviceName ?? "fixture-host"}`,
      dropped: 0,
      lastError: null,
      lastSyncedAt: null,
      pending: 0,
      state: "signed-in",
    };
    return context.cloud;
  }),
  logout: base.cloud.logout.handler(({ context }) => {
    context.cloud = { cloudUrl: FIXTURE_CLOUD_URL, revokeError: null, state: "signed-out" };
    return context.cloud;
  }),
  // no verb reaches these; the contract asks every server to answer them
  deleteAccount: base.cloud.deleteAccount.handler(({ errors }) => {
    throw errors.PRECONDITION_FAILED({ message: "no account in the fixture" });
  }),
  devices: base.cloud.devices.handler(() => ({ devices: [] })),
  prefs: base.cloud.prefs.handler(() => ({ phoneRequests: true })),
  revokeDevice: base.cloud.revokeDevice.handler(({ errors }) => {
    throw errors.NOT_FOUND({ message: "no devices in the fixture" });
  }),
  setPrefs: base.cloud.setPrefs.handler(({ input }) => input),
  signUp: base.cloud.signUp.handler(({ errors }) => {
    throw errors.FORBIDDEN({ message: "no invite in the fixture" });
  }),
  status: base.cloud.status.handler(({ context }) => context.cloud),
  syncNow: base.cloud.syncNow.handler(({ context }) => context.cloud),
};

const annotationsRouter = {
  // with `place`, the quote must be in the file's bytes, and the highlight is anchored on it
  add: base.annotations.add.handler(({ context, input, errors }) => {
    const placed = input.place !== undefined;
    if (placed && !(context.vault.get(input.path) ?? "").includes(input.quote)) {
      throw errors.BAD_REQUEST({ message: "That passage isn't in the item's text." });
    }
    const annotations = context.annotations.get(input.path) ?? [];
    annotations.push({
      id: input.id,
      passage: placed ? input.quote : null,
      quote: input.quote,
      replies: [],
      root: {
        createdAt: 1,
        quote: input.quote,
        source: input.source ?? "user",
        text: input.text,
        updatedAt: 1,
      },
      state: placed ? "anchored" : "missing",
    });
    context.annotations.set(input.path, annotations);
    return annotationsBody(context, input.path);
  }),
  edit: base.annotations.edit.handler(({ context, input, errors }) => {
    const annotation = (context.annotations.get(input.path) ?? []).find(
      (row) => row.id === input.id,
    );
    if (annotation === undefined) {
      throw errors.BAD_REQUEST({ message: `no annotation ${input.id}` });
    }
    annotation.root = { ...annotation.root, text: input.text, updatedAt: 2 };
    return annotationsBody(context, input.path);
  }),
  list: base.annotations.list.handler(({ context, input }) => annotationsBody(context, input.path)),
  remove: base.annotations.remove.handler(({ context, input, errors }) => {
    const annotations = context.annotations.get(input.path) ?? [];
    const remaining = annotations.filter((row) => row.id !== input.id);
    if (remaining.length === annotations.length) {
      throw errors.NOT_FOUND({ message: `no annotation ${input.id}` });
    }
    context.annotations.set(input.path, remaining);
    return { ...annotationsBody(context, input.path), removedIds: [input.id] };
  }),
  reply: base.annotations.reply.handler(({ context, input, errors }) => {
    const annotations = context.annotations.get(input.path) ?? [];
    const annotation = annotations.find((row) => row.id === input.parentId);
    if (annotation === undefined) {
      throw errors.NOT_FOUND({ message: `no annotation ${input.parentId}` });
    }
    annotation.replies.push({
      entry: { createdAt: 2, source: input.source ?? "user", text: input.text, updatedAt: 2 },
      id: input.id,
    });
    return annotationsBody(context, input.path);
  }),
};

const FIXTURE_CONNECTORS: ConnectorsResponse = {
  agent: { displayName: "Claude", id: "claude" },
  servers: [],
};

// no verb reaches these; the contract asks every server to answer them
const connectorsRouter = {
  add: base.connectors.add.handler(() => FIXTURE_CONNECTORS),
  list: base.connectors.list.handler(() => FIXTURE_CONNECTORS),
  remove: base.connectors.remove.handler(() => FIXTURE_CONNECTORS),
  signIn: base.connectors.signIn.handler(() => FIXTURE_CONNECTORS),
};

const foldersRouter = {
  add: base.folders.add.handler(({ context, input, errors }) => {
    if (context.folders.folders.includes(input.path)) {
      throw errors.ALREADY_EXISTS({ message: `"${input.path}" is connected` });
    }
    context.folders.folders.push(input.path);
    return context.folders;
  }),
  list: base.folders.list.handler(({ context }) => context.folders),
  remove: base.folders.remove.handler(({ context, input, errors }) => {
    const before = context.folders.folders.length;
    context.folders.folders = context.folders.folders.filter((row) => row !== input.path);
    if (context.folders.folders.length === before) {
      throw errors.NOT_FOUND({ message: `not connected: ${input.path}` });
    }
    return context.folders;
  }),
};

// the real index over the fixture vault, so a leaf sees the rows and the grammar the server's do
const indexOf = (vault: Map<string, string>): KnowledgeIndex => {
  const index = new KnowledgeIndex();
  for (const [path, body] of vault) {
    if (isDocPath(path)) {
      index.setDoc(path, body);
    } else {
      index.setOther(path);
    }
  }
  return index;
};

type ItemFilter = Omit<KnowledgeItemPathsRequest, "limit" | "offset">;

const savedKeyOf = (row: ItemRowWire): number =>
  (row.saved === null ? null : parseItemTime(row.saved)) ?? row.modifiedMs ?? 0;

const compareText = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

const rowPasses = (row: ItemRowWire, filter: ItemFilter): boolean => {
  const { folder, q, site, tag } = filter;
  const subfolders = filter.subfolders ?? true;
  const since = filter.since === undefined ? null : parseItemTime(filter.since);
  const inFolder =
    folder === undefined ||
    (folder === ""
      ? subfolders || row.folder === ""
      : row.folder === folder || (subfolders && row.folder.startsWith(`${folder}/`)));
  return (
    inFolder &&
    (tag === undefined || row.tags.some((candidate) => tagInFamily(candidate, tag))) &&
    (filter.untagged !== true || row.tags.length === 0) &&
    (site === undefined || siteMatches(row.host, site)) &&
    (since === null || savedKeyOf(row) >= since) &&
    (q === undefined || row.title.toLowerCase().includes(q.toLowerCase()))
  );
};

// the index's rules over the seeded rows: the filters, pinned first in every sort, kind counts
// that ignore the request's kinds
const selectRows = (rows: readonly ItemRowWire[], filter: ItemFilter) => {
  const kindCounts: Record<ItemKind, number> = {
    audio: 0,
    file: 0,
    image: 0,
    link: 0,
    note: 0,
    pdf: 0,
    video: 0,
  };
  const kinds = filter.kinds === undefined ? null : new Set(filter.kinds);
  const passed = rows.filter((row) => rowPasses(row, filter));
  for (const row of passed) {
    kindCounts[row.kind] += 1;
  }
  const sort = filter.sort ?? "saved";
  const byKey = (a: ItemRowWire, b: ItemRowWire): number => {
    if (sort === "title") {
      return compareText(a.title.toLowerCase(), b.title.toLowerCase());
    }
    if (sort === "modified") {
      return (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0);
    }
    return savedKeyOf(b) - savedKeyOf(a);
  };
  const order = passed
    .filter((row) => kinds === null || kinds.has(row.kind))
    .toSorted(
      (a, b) => Number(b.pinned) - Number(a.pinned) || byKey(a, b) || compareText(a.path, b.path),
    );
  return { kindCounts, order };
};

const isHiddenFolder = (folder: string): boolean =>
  isVaultMetadataPath(folder) ||
  ["assets", UNSORTED_FOLDER].some((h) => folder === h || folder.startsWith(`${h}/`));

const scopesOf = (rows: readonly ItemRowWire[]) => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (let at = row.folder; at !== ""; at = dirnamePath(at)) {
      counts.set(at, (counts.get(at) ?? 0) + 1);
    }
  }
  return {
    folders: [...counts]
      .filter(([path]) => !isHiddenFolder(path))
      .toSorted(([a], [b]) => compareText(a, b))
      .map(([path, items]) => ({ items, path })),
    total: rows.length,
    unsorted: rows.filter(
      (row) => row.folder === UNSORTED_FOLDER || row.folder.startsWith(`${UNSORTED_FOLDER}/`),
    ).length,
    untagged: rows.filter((row) => row.tags.length === 0).length,
  };
};

const knowledgeRouter = {
  backlinks: base.knowledge.backlinks.handler(({ context, input }) => ({
    backlinks: context.backlinks,
    path: input.path,
    total: context.backlinks.length,
  })),
  // the real fold over the fixture vault: a stub list would not exercise the rows' shape
  matches: base.knowledge.matches.handler(({ context, input }) =>
    collectVaultMatches(
      [...context.vault].map(([path, content]) => ({
        body: searchBodyOf(content),
        path,
        title: docStem(path),
      })),
      input.q,
      { caseSensitive: input.caseSensitive, wholeWord: input.wholeWord },
      input.limit,
    ),
  ),
  related: base.knowledge.related.handler(({ context, input }) => ({
    path: input.path,
    related: context.related.slice(0, input.limit),
  })),
  renameTag: base.knowledge.renameTag.handler(({ context, input }) => ({
    from: input.from,
    rewritten: [...context.vault.keys()].filter((path) => path.startsWith("notes/")),
    skipped: [],
    to: input.to,
  })),
  search: base.knowledge.search.handler(({ context, input }) => ({
    results: input.q.length === 0 ? [] : context.searchResults,
  })),
  tags: base.knowledge.tags.handler(({ context }) => ({
    tags: context.tags,
    total: context.tags.length,
  })),
  wikiTargets: base.knowledge.wikiTargets.handler(() => ({ targets: [] })),
  findByUrl: base.knowledge.findByUrl.handler(({ context, input }) => {
    const key = urlKey(input.url);
    const found =
      key === null
        ? []
        : context.items.filter((row) => row.url !== null && urlKey(row.url) === key);
    return {
      items: found
        .toSorted(
          (a, b) =>
            Number(a.pending) - Number(b.pending) ||
            savedKeyOf(a) - savedKeyOf(b) ||
            compareText(a.path, b.path),
        )
        .slice(0, 50),
      key,
    };
  }),
  itemPaths: base.knowledge.itemPaths.handler(({ context, input }) => {
    const { order } = selectRows(context.items, input);
    return {
      paths: order.slice(input.offset, input.offset + input.limit).map((row) => row.path),
      total: order.length,
    };
  }),
  items: base.knowledge.items.handler(({ context, input }) => {
    const { kindCounts, order } = selectRows(context.items, input);
    return {
      items: order.slice(input.offset, input.offset + input.limit),
      kindCounts,
      total: order.length,
    };
  }),
  itemsAt: base.knowledge.itemsAt.handler(({ context, input }) => ({
    items: input.paths.flatMap((path) => context.items.filter((row) => row.path === path)),
  })),
  pathForNoteId: base.knowledge.pathForNoteId.handler(({ context, input }) => ({
    path: indexOf(context.vault).pathForNoteId(input.id, input.lastPath),
    pending: false,
  })),
  scopes: base.knowledge.scopes.handler(({ context }) => scopesOf(context.items)),
};

const systemRouter = {
  browserHandoff: base.system.browserHandoff.handler(({ context, errors }) => {
    if (!context.servesUi) {
      throw errors.NOT_FOUND({ message: "This server serves no UI (an unbuilt checkout)." });
    }
    return { nonce: FIXTURE_HANDOFF_NONCE };
  }),
  guide: base.system.guide.handler(({ context }) => ({ markdown: context.guideMarkdown })),
  status: base.system.status.handler(({ context }) => {
    const status: SystemStatusResponse = {
      agent: context.agent,
      dataDir: context.dataDir,
      mediaToken: FIXTURE_MEDIA_TOKEN,
      schemaVersion: 3,
      uptimeMs: 65_000,
      vaultDir: "/fixture/vault",
      version: "9.9.9-fixture",
    };
    return status;
  }),
};

const threadsRouter = {
  answerInteraction: base.threads.answerInteraction.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    const interaction = entry?.pendingInteractions.find((row) => row.id === input.interactionId);
    if (entry === undefined || interaction === undefined) {
      throw errors.NOT_FOUND({ message: "Interaction not found" });
    }
    const resolved: PendingInteraction = {
      ...interaction,
      decision: input.decision,
      resolvedAt: 1_700_000_002_000,
      status: "resolved",
    };
    entry.pendingInteractions = entry.pendingInteractions.map((row) =>
      row.id === resolved.id ? resolved : row,
    );
    return { interaction: resolved };
  }),
  archive: base.threads.archive.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    if (entry === undefined) {
      throw errors.NOT_FOUND({ message: "Not found" });
    }
    entry.thread = { ...entry.thread, archivedAt: 1_700_000_001_000 };
    return { thread: entry.thread };
  }),
  create: base.threads.create.handler(({ context, input }) => {
    const overrides: Partial<Thread> & Pick<Thread, "id"> = {
      id: context.nextCreatedThreadId,
      originDocPath: input.originDocPath ?? null,
    };
    if (input.title !== undefined) {
      overrides.title = input.title;
    }
    const thread = makeThread(overrides);
    context.threads.push({ pendingInteractions: [], thread, timeline: EMPTY_TIMELINE });
    return { thread };
  }),
  get: base.threads.get.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    if (entry === undefined) {
      throw errors.NOT_FOUND({ message: "Not found" });
    }
    const nextStatus = entry.statusSequence?.shift();
    if (nextStatus !== undefined) {
      entry.thread = { ...entry.thread, status: nextStatus };
    }
    return {
      pendingInteractions: entry.pendingInteractions,
      queuedMessages: entry.queuedMessages ?? [],
      thread: entry.thread,
    };
  }),
  interrupt: base.threads.interrupt.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    if (entry === undefined) {
      throw errors.NOT_FOUND({ message: "Not found" });
    }
    if (entry.thread.status === "idle" || entry.thread.status === "error") {
      return { stop: "not-running", thread: entry.thread };
    }
    entry.thread = { ...entry.thread, status: "stopping" };
    return { stop: "requested", thread: entry.thread };
  }),
  // one page whatever the limit: paging is the real composition's (action-list.test.ts).
  list: base.threads.list.handler(({ context, input }) => ({
    nextCursor: null,
    threads: context.threads
      .map((entry) => entry.thread)
      .filter((thread) => input.includeArchived === true || thread.archivedAt === null),
  })),
  listInteractions: base.threads.listInteractions.handler(({ context, input }) => ({
    interactions: context.threads
      .filter((entry) => input.threadId === undefined || entry.thread.id === input.threadId)
      .flatMap((entry) => entry.pendingInteractions),
  })),
  send: base.threads.send.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    if (entry === undefined) {
      throw errors.NOT_FOUND({ message: "Not found" });
    }
    const refusal = context.refuseSend;
    if (refusal !== null) {
      throw errors.PROVIDER_UNAVAILABLE({ message: refusal.message });
    }
    context.sent.push({ preset: input.preset ?? null, text: input.text, threadId: input.threadId });
    return { kind: "started", turnId: `turn_for_${input.threadId}` };
  }),
  timeline: base.threads.timeline.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    if (entry === undefined) {
      throw errors.NOT_FOUND({ message: "Not found" });
    }
    return { kind: "full", timeline: entry.timeline };
  }),
  turnChanges: base.threads.turnChanges.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    if (entry === undefined) {
      throw errors.NOT_FOUND({ message: "Not found" });
    }
    return { turns: entry.turnChanges ?? [] };
  }),
  undoTurn: base.threads.undoTurn.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    const turn = entry?.turnChanges?.find((changes) => changes.turnId === input.turnId);
    if (entry === undefined || turn === undefined) {
      throw errors.NOT_FOUND({ message: "Not found" });
    }
    if (turn.state === "undone") {
      throw errors.CONFLICT({ message: `Turn ${turn.turnId} was already undone` });
    }
    const answer = entry.turnUndo ?? { kept: [], reverted: turn.paths };
    // the real route commits only what it wrote, so an undo that kept every note leaves the turn applied.
    if (answer.reverted.length > 0) {
      turn.state = "undone";
    }
    return answer;
  }),
};

const fillOf = (row: ItemRowWire): ItemFill => {
  if (row.pending) {
    return { state: "pending" };
  }
  return row.fetchError === null
    ? { state: "filled" }
    : { message: row.fetchError, state: "failed" };
};

export const makeItemRow = (path: string, fields: Partial<ItemRowWire>): ItemRowWire => ({
  author: null,
  bare: false,
  copy: null,
  cover: null,
  description: null,
  fetchError: null,
  fetched: null,
  file: null,
  fileBytes: null,
  folder: dirnamePath(path),
  host: null,
  id: null,
  kind: "note",
  modifiedMs: null,
  path,
  pending: false,
  pinned: false,
  preview: "",
  published: null,
  saved: FIXTURE_SAVED,
  site: null,
  tags: [],
  title: docStem(path),
  url: null,
  ...fields,
});

const freeItemPath = (state: FixtureState, folder: string, stem: string): string =>
  freePath(
    folder,
    stem,
    ".md",
    takenIgnoringCase([...state.vault.keys(), ...state.items.map((row) => row.path)]),
  );

// a url the library holds answers that item; any other is a pending stub in the folder named
interface UrlSave {
  folder: string | undefined;
  tags: readonly string[] | undefined;
  title: string | null;
  url: string;
}

const saveUrl = (state: FixtureState, save: UrlSave): ItemSaveResponse => {
  const key = urlKey(save.url);
  const existing = state.items.find((row) => row.url !== null && urlKey(row.url) === key);
  if (existing !== undefined) {
    return { fill: fillOf(existing), outcome: "exists", path: existing.path };
  }
  const path = freeItemPath(state, save.folder ?? UNSORTED_FOLDER, itemStem(save.title, save.url));
  state.items.push(
    makeItemRow(path, {
      host: urlHost(save.url),
      kind: kindForUrl(save.url),
      pending: true,
      tags: [...(save.tags ?? [])],
      url: cleanUrl(save.url),
    }),
  );
  state.vaultLog.push(`save ${path}`);
  return { fill: { state: "pending" }, outcome: "created", path };
};

const sameTag = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const itemsRouter = {
  refresh: base.items.refresh.handler(({ context, input, errors }) => {
    const row = context.items.find((each) => each.path === input.path);
    if (row === undefined) {
      throw errors.NOT_FOUND({ message: `${input.path} is not an item` });
    }
    if (row.url === null || !URL_ITEM_KINDS.some((kind) => kind === row.kind)) {
      throw errors.BAD_REQUEST({ message: "Only a saved link can be refreshed." });
    }
    return { fill: fillOf(row), path: row.path };
  }),
  saveFile: base.items.saveFile.handler(({ context, input, errors }) => {
    if (input.file.size > ITEM_FILE_MAX_BYTES) {
      throw errors.PAYLOAD_TOO_LARGE({ message: fileTooLargeMessage(input.name, input.file.size) });
    }
    if (isDocPath(input.name) || isVaultMetadataPath(input.name)) {
      throw errors.INVALID_PATH({ message: "a note is saved as text, not as a file" });
    }
    const name = basenamePath(input.name);
    const stem = itemNameFromTitle(name.slice(0, name.length - extnamePath(name).length));
    const path = freeItemPath(context, input.folder ?? UNSORTED_FOLDER, stem ?? "File");
    context.items.push(
      makeItemRow(path, {
        file: `assets/${name}`,
        fileBytes: input.file.size,
        kind: fileKindOf(name) ?? "file",
        tags: [...(input.tags ?? [])],
        url: input.url === undefined ? null : cleanUrl(input.url),
      }),
    );
    context.vaultLog.push(`save ${path}`);
    return { fill: { state: "filled" }, outcome: "created", path };
  }),
  saveLink: base.items.saveLink.handler(({ context, input }) =>
    saveUrl(context, {
      folder: input.folder,
      tags: input.tags,
      title: input.title ?? null,
      url: input.url,
    }),
  ),
  savePage: base.items.savePage.handler(({ context, input }) =>
    saveUrl(context, {
      folder: input.folder,
      tags: input.tags,
      title: input.page.title === "" ? null : input.page.title,
      url: input.page.url,
    }),
  ),
  tag: base.items.tag.handler(({ context, input }) => ({
    results: input.paths.map((path) => {
      const row = context.items.find((each) => each.path === path);
      if (row === undefined) {
        return { inline: [], outcome: "missing" as const, path };
      }
      const kept = row.tags.filter((tag) => !input.remove.some((gone) => sameTag(gone, tag)));
      const added = input.add.filter((tag) => !kept.some((held) => sameTag(held, tag)));
      const next = [...kept, ...added];
      const changed = next.length !== row.tags.length || added.length > 0;
      row.tags = next;
      return { inline: [], outcome: changed ? ("changed" as const) : ("unchanged" as const), path };
    }),
  })),
};

// a start answers its job running, and the status after it finished: one poll sees it done. The
// rows close over the state itself, since a handler's context is a shallow copy of it and a job
// reassigned on the copy would be gone by the next call.
const importsRouterFor = (state: FixtureState) => ({
  cancel: base.imports.cancel.handler(({ input, errors }) => {
    const job = state.importJob;
    if (job?.id !== input.id) {
      throw errors.NOT_FOUND({ message: "No import is running" });
    }
    if (job.state === "running") {
      state.importJob = { ...job, finishedAt: 1_700_000_001_000, state: "cancelled" };
    }
    return { job: state.importJob ?? job };
  }),
  plan: base.imports.plan.handler(({ errors }) => {
    if (state.importPlan === null) {
      throw errors.IMPORT_UNREADABLE({
        data: { reason: "not-csv" },
        message: "This file isn't a Raindrop export",
      });
    }
    return state.importPlan;
  }),
  start: base.imports.start.handler(({ input, errors }) => {
    if (state.importJob?.state === "running") {
      throw errors.CONFLICT({ message: "An import is already running." });
    }
    const plan = state.importPlan;
    if (plan?.planId !== input.planId) {
      throw errors.NOT_FOUND({ message: "That import plan is gone; choose the file again." });
    }
    state.importPlan = null;
    const job: ImportJob = {
      added: plan.items,
      alreadySaved: plan.alreadySaved,
      finishedAt: null,
      highlights: plan.highlights,
      id: `import_${plan.planId}`,
      message: null,
      source: "raindrop",
      startedAt: 1_700_000_000_000,
      state: "running",
      total: plan.items,
    };
    state.importJob =
      state.importFailure === null
        ? { ...job, finishedAt: 1_700_000_001_000, state: "done" }
        : { ...job, finishedAt: 1_700_000_001_000, message: state.importFailure, state: "failed" };
    return { job };
  }),
  status: base.imports.status.handler(() => ({ job: state.importJob })),
});

const parentFolders = (path: string): string[] => {
  const segments = path.split("/");
  return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join("/"));
};

const vaultRouter = {
  assetWrite: base.vault.assetWrite.handler(({ input }) => ({
    path: `${input.dir}/${input.baseName}`,
  })),
  // a file is held as its text: the fixture keeps one map for every path
  createFile: base.vault.createFile.handler(async ({ context, input, errors }) => {
    if (context.vault.has(input.path)) {
      throw errors.ALREADY_EXISTS({ message: `${input.path} already exists` });
    }
    context.vault.set(input.path, await input.file.text());
    context.vaultLog.push(`createFile ${input.path}`);
    return { path: input.path };
  }),
  commitNow: base.vault.commitNow.handler(({ context, input }) => {
    context.vaultLog.push(input === undefined ? "commitNow" : `commitNow ${input.paths.join(" ")}`);
    return { files: 0 };
  }),
  // a path with revisions and no bytes on disk: the fixture's "deleted".
  deleted: base.vault.deleted.handler(({ context }) => ({
    entries: [...context.revisions]
      .filter(([path]) => !context.vault.has(path))
      .flatMap(([path, rows]) => {
        const [newest] = rows;
        return newest === undefined
          ? []
          : [
              {
                deletedAt: newest.revision.authoredAt,
                heldBy: null,
                kind: isDocPath(path) ? ("doc" as const) : ("file" as const),
                path,
                sha: newest.revision.sha,
              },
            ];
      }),
  })),
  history: base.vault.history.handler(({ context, input }) => ({
    revisions: (context.revisions.get(input.path) ?? []).map((row) => row.revision),
  })),
  mkdir: base.vault.mkdir.handler(({ input }) => ({ path: input.path })),
  prefs: base.vault.prefs.handler(({ context }) => context.vaultPrefs),
  read: base.vault.read.handler(({ context, input, errors }) => {
    const content = context.vault.get(input.path);
    if (content === undefined) {
      throw errors.NOT_FOUND({ message: `No file at ${input.path}` });
    }
    const racing = context.concurrentWrite;
    if (racing?.path === input.path) {
      context.concurrentWrite = null;
      context.vault.set(racing.path, racing.content);
    }
    return { content, path: input.path };
  }),
  remove: base.vault.remove.handler(({ context, input, errors }) => {
    if (!context.vault.delete(input.path)) {
      throw errors.NOT_FOUND({ message: `No file at ${input.path}` });
    }
    return { ok: true } as const;
  }),
  rename: base.vault.rename.handler(({ context, input, errors }) => {
    const content = context.vault.get(input.from);
    if (content === undefined) {
      throw errors.NOT_FOUND({ message: `No file at ${input.from}` });
    }
    context.vault.delete(input.from);
    context.vault.set(input.to, content);
    return { path: input.to, rewritten: [], skipped: [] };
  }),
  revision: base.vault.revision.handler(({ context, input, errors }) => {
    const row = (context.revisions.get(input.path) ?? []).find(
      ({ revision }) => revision.sha === input.sha,
    );
    if (row === undefined) {
      throw errors.NOT_FOUND({ message: `${input.path} does not exist at ${input.sha}` });
    }
    return { content: row.content };
  }),
  revisionBytes: base.vault.revisionBytes.handler(({ context, input, errors }) => {
    const row = (context.revisions.get(input.path) ?? []).find(
      ({ revision }) => revision.sha === input.sha,
    );
    if (row === undefined) {
      throw errors.NOT_FOUND({ message: `${input.path} does not exist at ${input.sha}` });
    }
    return new Blob([row.content], { type: "application/octet-stream" });
  }),
  setPrefs: base.vault.setPrefs.handler(({ context, input }) => {
    context.vaultPrefs = { attachments: input.attachments };
    return context.vaultPrefs;
  }),
  // the status a choice leaves, signed out as a scratch data dir is: the account is no remote
  // until a sign-in, and a url is the vault's own origin, not yet synced.
  setRemote: base.vault.setRemote.handler(({ context, input }) => {
    const { conflicts, device, externalSync, lastError, lastSyncAt, tooLarge } =
      context.vaultStatus;
    const fields = { conflicts, device, externalSync, lastError, lastSyncAt, tooLarge };
    return input.kind === "account"
      ? { ...fields, state: "no-remote" }
      : { ...fields, remote: input.url, remoteSource: "explicit", state: "dirty" };
  }),
  status: base.vault.status.handler(({ context }) => context.vaultStatus),
  syncNow: base.vault.syncNow.handler(({ context }) => context.vaultStatus),
  tree: base.vault.tree.handler(({ context }) => ({
    entries: deriveTree(context.vault),
    name: "vault",
    root: "/fixture/vault",
  })),
  write: base.vault.write.handler(async ({ context, input, errors }) => {
    if (parentFolders(input.path).some((folder) => context.vault.has(folder))) {
      throw errors.CONFLICT({ message: `A file shadows a parent folder of ${input.path}` });
    }
    const { guard } = input;
    if (guard.kind !== "overwrite") {
      const current = context.vault.get(input.path);
      const refusal = await judgeGuard(
        guard,
        current === undefined ? null : async () => await Promise.resolve(current),
      );
      if (refusal !== null) {
        throw guardRefusalError(errors, input.path, refusal);
      }
    }
    context.vault.set(input.path, input.content);
    context.vaultLog.push(`write ${input.path}`);
    return { path: input.path };
  }),
};

// a middleware rather than a handler interceptor, so the refusal reaches the client as an ORPCError like a real one.
const fixtureRouterFor = (state: FixtureState) =>
  base
    .use(({ context, next }) => {
      const failure = context.failWith;
      if (failure !== null) {
        throw new ORPCError(failure.code, { message: failure.message });
      }
      return next();
    })
    .router({
      agents: agentsRouter,
      annotations: annotationsRouter,
      cloud: cloudRouter,
      connectors: connectorsRouter,
      folders: foldersRouter,
      imports: importsRouterFor(state),
      items: itemsRouter,
      knowledge: knowledgeRouter,
      system: systemRouter,
      threads: threadsRouter,
      vault: vaultRouter,
    });

export interface FixtureServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export const serveFixture = async (state: FixtureState): Promise<FixtureServer> => {
  const handler = new RPCHandler(fixtureRouterFor(state));
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${FIXTURE_SERVER_TOKEN}`) {
      response.writeHead(401, { "content-type": "text/plain" });
      response.end("This request carried no valid inteligir device token");
      return;
    }
    void (async () => {
      const { matched } = await handler.handle(request, response, {
        context: state,
        prefix: RPC_PREFIX,
      });
      if (!matched) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("Not found");
      }
    })();
  });
  // oxlint-disable-next-line promise/avoid-new -- bridges the http server's "listening" callback
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = boundAddressSchema.parse(server.address());
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      // oxlint-disable-next-line promise/avoid-new -- bridges the http server's close callback
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
};
