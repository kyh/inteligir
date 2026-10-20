// saving a link or a page: the stub is written at once, under the url key's lock, and the fill
// reads the page afterwards (fill-item.ts), scheduled by the pending store (fill-queue.ts). A save
// of a url the library already holds answers `exists` and adds what it carries to that item: its
// tags, its selection as a highlight, and with `keepCopy` a copy of the page, never rewriting the
// item's text or moving it.

import { randomBytes } from "node:crypto";

import type { DbConnection } from "@repo/db/connection";
import type { ItemFill } from "@repo/contract/local/items/items-schema";
import { markerRootIds } from "@repo/notes/annotations/marker-ids";
import { clipQuote, mintAnnotationId } from "@repo/notes/annotations/store-schema";
import { isItemStub, itemFactsOf } from "@repo/notes/items/item-frontmatter";
import { UNSORTED_FOLDER, URL_ITEM_KINDS } from "@repo/notes/items/item-kind";
import { itemStem } from "@repo/notes/items/item-name";
import { linkStubText } from "@repo/notes/items/item-stub";
import { addFrontmatterTags } from "@repo/notes/items/item-tags";
import { cleanUrl, urlKey } from "@repo/notes/items/item-url";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";

import { AnnotationsError } from "../../annotations/annotations-service";
import type { AnnotationsService } from "../../annotations/annotations-service";
import type { DebugLog } from "../../debug-log";
import type { KnowledgeRuntime } from "../../knowledge/knowledge-runtime";
import type { ImageDownscale } from "../../media/image-downscale";
import type { ItemCore } from "../item-core";
import { ItemsError } from "../items-error";
import type { RefreshInput, SaveLinkInput, SaveOutcome, SavePageInput } from "../items-service";
import { systemClock } from "./capture-ports";
import type { CapturePorts } from "./capture-ports";
import { fillItem } from "./fill-item";
import type { FillContext, FillTarget } from "./fill-item";
import { createFillQueue } from "./fill-queue";
import { createFillRunner } from "./fill-runner";
import { createGuardedFetch } from "./guarded-fetch";
import { foldDuplicate } from "./fold-duplicate";
import { createPendingFillsStore } from "./pending-fills-store";

export interface CaptureDeps {
  // its git read (isTracked): a fill renames only a stub of this Mac's that no commit holds yet
  core: ItemCore;
  knowledge: Pick<KnowledgeRuntime, "settle" | "findByUrl" | "itemsAt" | "pathForNoteId">;
  annotations: Pick<AnnotationsService, "add" | "list" | "placeWaiting">;
  // pending_fills
  db: DbConnection;
  dataDir: string;
  debugLog: DebugLog | undefined;
  version: string;
  ownPort: () => number | null;
  downscale: ImageDownscale;
  ports: CapturePorts;
}

export interface Capture {
  saveLink: (input: SaveLinkInput) => Promise<SaveOutcome>;
  savePage: (input: SavePageInput) => Promise<SaveOutcome>;
  refresh: (input: RefreshInput) => Promise<{ path: string; fill: ItemFill; wrote: string[] }>;
  // an own pending entry, the import's hand-off
  enqueue: (item: { id: string; path: string; url: string }, hints?: { cover?: string }) => void;
  // a stub the person wrote back through this Mac (a restore from Deleted or History, an Undo)
  // with no row: its fill is this Mac's own again. A stub a row holds keeps that row
  adoptOwn: (path: string) => Promise<void>;
  boot: () => void;
  dispose: () => Promise<void>;
}

// how long a save with `wait` holds its answer for the fill
const WAIT_MS = 60_000;
const TAG_TRIES = 3;
const PENDING: ItemFill = { state: "pending" };

const userAgentOf = (version: string): string =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 inteligir/${version}`;

// the Mac's own language first, its bare language after
const acceptLanguage = (): string => {
  const { locale } = Intl.DateTimeFormat().resolvedOptions();
  const [language = "en"] = locale.split("-");
  return locale === language ? locale : `${locale},${language};q=0.9`;
};

// an item's fill as its file says it
const fillStateOf = (content: string): ItemFill => {
  const facts = itemFactsOf(content);
  if (isItemStub(facts)) {
    return PENDING;
  }
  return facts.fetchError === null
    ? { state: "filled" }
    : { message: facts.fetchError, state: "failed" };
};

interface Request {
  url: string;
  title: string | null;
  folder: string | undefined;
  tags: readonly string[] | undefined;
  keepCopy: boolean;
  wait: boolean;
  // savePage's own page and selection; null for a link
  page: { html: string | null; selection: string | null } | null;
}

export const createCapture = (deps: CaptureDeps): Capture => {
  const { core } = deps;
  const clock = deps.ports.clock ?? systemClock;
  const debug = (line: string): void => {
    deps.debugLog?.(line);
  };
  const fetcher =
    deps.ports.fetcher ??
    createGuardedFetch({
      acceptLanguage: acceptLanguage(),
      lookup: deps.ports.lookup,
      ownPort: deps.ownPort,
      policy: deps.ports.policy,
      userAgent: userAgentOf(deps.version),
    });
  const runner = deps.ports.runner ?? createFillRunner();
  const supplied = new Map<string, { html: string; at: number }>();
  const context: FillContext = {
    annotations: deps.annotations,
    clock,
    core,
    debug,
    downscale: deps.downscale,
    fetcher,
    knowledge: deps.knowledge,
    runner,
  };
  // refreshes run outside the pending store, but dispose stops them too
  const refreshes = new Set<AbortController>();

  const queue = createFillQueue({
    clock,
    copyAfter: async (row, signal) => {
      const page = supplied.get(row.itemId) ?? null;
      supplied.delete(row.itemId);
      return await fillItem(context, {
        coverHint: null,
        itemId: row.itemId,
        keepCopy: true,
        mayRetry: false,
        onMoved: (moved) => {
          debug(`the copy of ${row.path} follows it to ${moved}`);
        },
        origin: "refresh",
        path: row.path,
        signal,
        supplied: page,
        text: "keep",
        url: row.url,
      });
    },
    debug,
    fillRow: async (target, signal, onMoved) => {
      const folded = await foldDuplicate({ core, knowledge: deps.knowledge }, target);
      if (folded !== null) {
        return { kind: "dropped", path: folded.into, wrote: folded.wrote };
      }
      return await fillItem(context, { ...target, onMoved, signal, text: "keep" });
    },
    store: createPendingFillsStore(deps.db),
    takeSupplied: (itemId) => {
      const page = supplied.get(itemId) ?? null;
      supplied.delete(itemId);
      return page;
    },
  });

  // the answer a save with `wait` gives once its fill ends, or pending after a minute
  const waited = async (
    itemId: string,
    path: string,
    wrote: readonly string[],
  ): Promise<SaveOutcome> => {
    const done = await queue.waitFor(itemId, WAIT_MS);
    if (done === null) {
      return { fill: PENDING, outcome: "created", path, wrote: [...wrote] };
    }
    const read = await core.read(done.path);
    const fill =
      done.fill.state === "pending" && read !== null ? fillStateOf(read.content) : done.fill;
    return { fill, outcome: "created", path: done.path, wrote: [...wrote, ...done.wrote] };
  };

  // a refresh, or a fill of an item that holds the url already, as this device's own action
  const fillNow = async (
    target: Omit<FillTarget, "signal" | "onMoved" | "mayRetry">,
  ): Promise<{ path: string; fill: ItemFill; wrote: string[] }> => {
    const controller = new AbortController();
    refreshes.add(controller);
    let { path } = target;
    try {
      const outcome = await fillItem(context, {
        ...target,
        mayRetry: false,
        onMoved: (moved) => {
          path = moved;
        },
        signal: controller.signal,
      });
      if (outcome.kind === "written") {
        return { fill: outcome.fill, path: outcome.path, wrote: outcome.wrote };
      }
      if (outcome.kind === "unread") {
        return { fill: { message: outcome.message, state: "failed" }, path, wrote: [] };
      }
      const read = await core.read(path);
      return {
        fill: read === null ? PENDING : fillStateOf(read.content),
        path,
        wrote: outcome.kind === "aborted" ? [] : outcome.wrote,
      };
    } finally {
      refreshes.delete(controller);
    }
  };

  // the work's answer, or null once a save's wait has run out (the work goes on)
  const withinWait = async <T>(work: Promise<T>): Promise<T | null> => {
    const timeout = Promise.withResolvers<null>();
    const cancel = clock.setTimer(WAIT_MS, () => {
      timeout.resolve(null);
    });
    try {
      return await Promise.race([work, timeout.promise]);
    } finally {
      cancel();
    }
  };

  // tags added under the item's compare-and-swap
  const addTags = async (path: string, tags: readonly string[]): Promise<string[]> => {
    if (tags.length === 0) {
      return [];
    }
    for (let attempt = 0; attempt < TAG_TRIES; attempt += 1) {
      const read = await core.read(path);
      const next = read === null ? null : addFrontmatterTags(read.content, tags);
      if (read === null || next === null || next === read.content) {
        return [];
      }
      if ((await core.write(path, next, read.hash)) === "written") {
        return [path];
      }
    }
    return [];
  };

  // a selection the person made is never dropped: placed in a filled item's text, waiting on a
  // stub's fill, or under the item's Highlights when its passage is not in the text. One the item
  // already holds as a highlight is not added again: the popup's Keep a copy of the page sends the
  // page again with the selection still in it
  const addSelection = async (path: string, text: string): Promise<string[]> => {
    const quote = clipQuote(text);
    const held = await deps.annotations.list(path).catch(() => null);
    if (held?.annotations.some((annotation) => annotation.quote === quote) === true) {
      return [];
    }
    const read = await core.read(path);
    const entry = {
      id: mintAnnotationId(randomBytes),
      path,
      quote,
      source: "user" as const,
      text: "",
    };
    if (read === null || isItemStub(itemFactsOf(read.content))) {
      const waiting = await deps.annotations.add(entry);
      return waiting.wrote;
    }
    try {
      const placed = await deps.annotations.add({ ...entry, place: { occurrence: 1 } });
      return placed.wrote;
    } catch (error) {
      if (!(error instanceof AnnotationsError) || error.code !== "passage-not-found") {
        throw error;
      }
    }
    const { wrote } = await deps.annotations.add(entry);
    for (let attempt = 0; attempt < TAG_TRIES; attempt += 1) {
      const current = await core.read(path);
      const itemId = current === null ? null : frontmatterId(current.content);
      if (current === null || itemId === null) {
        return wrote;
      }
      // this selection alone: any other unplaced highlight of a read item is one the person took
      // out of the text
      const placed = await deps.annotations.placeWaiting({
        content: current.content,
        final: true,
        itemId,
        only: [entry.id],
        path,
      });
      if (placed.content === current.content) {
        return wrote;
      }
      if ((await core.write(path, placed.content, current.hash)) === "written") {
        return [...wrote, path];
      }
    }
    return wrote;
  };

  // a background fill whose failure only the debug log hears of: nobody waits on it
  const inBackground = (path: string, work: Promise<unknown>): void => {
    void (async () => {
      try {
        await work;
      } catch (error) {
        debug(`fill of ${path} failed: ${error instanceof Error ? error.message : "unknown"}`);
      }
    })();
  };

  // `keepCopy` on a held url: a stub still waiting on its fill gains the copy there, or right
  // after the fill already under way; a filled link is refreshed for it, from the page a browser
  // handed over when there is one. A note or a file that carries the url keeps its own text, as a
  // refresh would refuse it
  const copyOfExisting = async (
    found: { path: string; fill: ItemFill },
    request: Request,
    wrote: readonly string[],
  ): Promise<SaveOutcome> => {
    const read = await core.read(found.path);
    const facts = read === null ? null : itemFactsOf(read.content);
    if (facts === null || !URL_ITEM_KINDS.some((kind) => kind === facts.kind)) {
      return { fill: found.fill, outcome: "exists", path: found.path, wrote: [...wrote] };
    }
    const itemId = read === null ? null : frontmatterId(read.content);
    const html = request.page?.html ?? null;
    if (itemId !== null && queue.has(itemId)) {
      if (html !== null) {
        supplied.set(itemId, { at: clock.now(), html });
      }
      queue.add({
        coverHint: null,
        itemId,
        keepCopy: true,
        origin: "own",
        path: found.path,
        url: request.url,
      });
      const done = request.wait ? await queue.waitFor(itemId, WAIT_MS) : null;
      return {
        fill: done?.fill ?? found.fill,
        outcome: "exists",
        path: done?.path ?? found.path,
        wrote: [...wrote, ...(done?.wrote ?? [])],
      };
    }
    const copying = fillNow({
      coverHint: null,
      itemId,
      keepCopy: true,
      origin: "refresh",
      path: found.path,
      supplied: html === null ? null : { at: clock.now(), html },
      text: "keep",
      url: request.url,
    });
    if (!request.wait) {
      inBackground(found.path, copying);
      return { fill: found.fill, outcome: "exists", path: found.path, wrote: [...wrote] };
    }
    const copied = await withinWait(copying);
    if (copied === null) {
      inBackground(found.path, copying);
      return { fill: found.fill, outcome: "exists", path: found.path, wrote: [...wrote] };
    }
    return {
      fill: copied.fill,
      outcome: "exists",
      path: copied.path,
      wrote: [...wrote, ...copied.wrote],
    };
  };

  // R22: what a save of a held url adds to the item, without touching its text or its place
  const addToExisting = async (
    found: { path: string; fill: ItemFill },
    request: Request,
  ): Promise<SaveOutcome> => {
    const wrote = await addTags(found.path, request.tags ?? []);
    const selection = request.page?.selection ?? null;
    if (selection !== null) {
      wrote.push(...(await addSelection(found.path, selection)));
    }
    if (!request.keepCopy) {
      return { fill: found.fill, outcome: "exists", path: found.path, wrote };
    }
    return await copyOfExisting(found, request, wrote);
  };

  const save = async (request: Request): Promise<SaveOutcome> => {
    const url = cleanUrl(request.url) ?? request.url;
    const created = await core.withUrlLock(urlKey(url) ?? url, async () => {
      const found = await core.existing(url);
      if (found !== null) {
        return { found };
      }
      const id = core.newId();
      const stub: Parameters<typeof linkStubText>[0] = {
        id,
        note: "",
        saved: core.now().getTime(),
        url,
      };
      if (request.tags !== undefined) {
        stub.tags = request.tags;
      }
      const written = await core.createDoc({
        content: linkStubText(stub),
        folder: request.folder ?? UNSORTED_FOLDER,
        stem: itemStem(request.title, url),
      });
      return { created: { id, path: written.path } };
    });
    if (created.found !== undefined) {
      return await addToExisting(created.found, request);
    }
    const { id, path } = created.created;
    const wrote = [path];
    // the selection waits in the store until the fill places it
    if (request.page?.selection !== null && request.page?.selection !== undefined) {
      const highlight = await deps.annotations.add({
        id: mintAnnotationId(randomBytes),
        path,
        quote: clipQuote(request.page.selection),
        source: "user",
        text: "",
      });
      wrote.push(...highlight.wrote);
    }
    if (request.page?.html !== null && request.page?.html !== undefined) {
      supplied.set(id, { at: clock.now(), html: request.page.html });
    }
    queue.add({
      coverHint: null,
      itemId: id,
      keepCopy: request.keepCopy,
      origin: "own",
      path,
      url,
    });
    if (!request.wait) {
      return { fill: PENDING, outcome: "created", path, wrote };
    }
    return await waited(id, path, wrote);
  };

  return {
    async adoptOwn(path) {
      const read = await core.read(path);
      if (read === null) {
        return;
      }
      const facts = itemFactsOf(read.content);
      const itemId = frontmatterId(read.content);
      if (!isItemStub(facts) || facts.url === null || itemId === null || queue.has(itemId)) {
        return;
      }
      queue.add({
        coverHint: null,
        itemId,
        keepCopy: false,
        origin: "own",
        path,
        url: facts.url,
      });
    },

    boot: () => {
      queue.boot();
    },

    dispose: async () => {
      for (const controller of refreshes) {
        controller.abort();
      }
      await queue.dispose();
      await runner.dispose();
    },

    enqueue: (item, hints) => {
      queue.add({
        coverHint: hints?.cover ?? null,
        itemId: item.id,
        keepCopy: false,
        origin: "import",
        path: item.path,
        url: item.url,
      });
    },

    async refresh(input) {
      const read = await core.read(input.path);
      if (read === null) {
        throw new ItemsError("not-found", { path: input.path });
      }
      const facts = itemFactsOf(read.content);
      if (facts.url === null || !URL_ITEM_KINDS.some((kind) => kind === facts.kind)) {
        throw new ItemsError("not-url-item");
      }
      if (input.text === "replace" && markerRootIds(read.content).size > 0) {
        throw new ItemsError("has-highlights");
      }
      const refreshing = fillNow({
        coverHint: null,
        itemId: frontmatterId(read.content),
        keepCopy: input.keepCopy,
        origin: "refresh",
        path: input.path,
        supplied: null,
        text: input.text,
        url: facts.url,
      });
      if (input.wait) {
        const answered = await withinWait(refreshing);
        if (answered !== null) {
          return answered;
        }
      }
      inBackground(input.path, refreshing);
      return { fill: fillStateOf(read.content), path: input.path, wrote: [] };
    },

    saveLink: async (input) =>
      await save({
        folder: input.folder,
        keepCopy: input.keepCopy,
        page: null,
        tags: input.tags,
        title: input.title ?? null,
        url: input.url,
        wait: input.wait,
      }),

    savePage: async (input) =>
      await save({
        folder: input.folder,
        keepCopy: input.keepCopy,
        page: { html: input.page.html, selection: input.page.selection?.text ?? null },
        tags: input.tags,
        title: input.page.title.trim() === "" ? null : input.page.title,
        url: input.page.url,
        wait: input.wait,
      }),
  };
};
