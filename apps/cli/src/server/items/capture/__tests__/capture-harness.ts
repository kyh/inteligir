// a capture over a booted server's own core, index and database, with every seam a suite owns
// replaced: a fetch that answers from a table (and can hold an answer), an extract that reads the
// test's tiny pages by pattern, a clock that moves only when told, and annotations that record what
// they were asked and append a Highlights section the way the real placement does for `final`.

import { readFileSync } from "node:fs";
import nodePath from "node:path";
import { setImmediate } from "node:timers/promises";

import { AnnotationsError } from "../../../annotations/annotations-service";
import type { AnnotationsService } from "../../../annotations/annotations-service";
import { bootTestApp } from "../../../__tests__/boot-app";
import type { BootedTestApp } from "../../../__tests__/boot-app";
import { createImageDownscale } from "../../../media/image-downscale";
import type { ItemCore } from "../../item-core";
import { createCapture } from "../capture";
import type { Capture } from "../capture";
import type { CaptureClock } from "../capture-ports";
import type { FillJobInput, FillResult } from "../fill-protocol";
import { inlineFillRunner } from "../fill-runner";
import type { Reach } from "../address-guard";
import type { FetchFailure, FetchRequest, FetchResult, GuardedFetch } from "../guarded-fetch";

export const START_MS = Date.UTC(2026, 9, 17, 9, 12, 30);

interface ManualClock extends CaptureClock {
  // runs every timer due within `ms`, in order, letting each one's work settle
  advance: (ms: number) => Promise<void>;
}

const settleWork = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn += 1) {
    await setImmediate();
  }
};

const manualClock = (): ManualClock => {
  let now = START_MS;
  let nextId = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const [due] = [...timers]
          .filter(([, timer]) => timer.at <= target)
          .toSorted(([, a], [, b]) => a.at - b.at);
        if (due === undefined) {
          break;
        }
        const [id, timer] = due;
        timers.delete(id);
        now = Math.max(now, timer.at);
        timer.run();
        await settleWork();
      }
      now = target;
      await settleWork();
    },
    now: () => now,
    setTimer: (ms, run) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: now + Math.max(0, ms), run });
      return () => {
        timers.delete(id);
      };
    },
  };
};

export type Route =
  | { html: string }
  | { bytes: Uint8Array; mediaType: string; truncated?: boolean }
  | { failure: FetchFailure };

export interface FakeFetcher extends GuardedFetch {
  requests: string[];
  // every request's url with the reach it was made under, refused or not
  reaches: { url: string; reach: Reach | null }[];
  routes: Map<string, Route>;
  // the next fetch of `url` waits until the answer is released
  hold: (url: string) => { reached: Promise<true>; release: () => void };
}

// the hosts a suite's network puts in private space; every other host is public
const PRIVATE_HOST = /^(?:10\.|192\.168\.|router\.lan$)/u;

const hostReach = (url: string): Reach => {
  try {
    return PRIVATE_HOST.test(new URL(url).hostname) ? "private" : "public";
  } catch {
    return "public";
  }
};

// the guard's own rule over that network: private space only from a private saved address
export const fakeFetcher = (routes: Record<string, Route> = {}): FakeFetcher => {
  const table = new Map(Object.entries(routes));
  const requests: string[] = [];
  const reaches: { url: string; reach: Reach | null }[] = [];
  const holds = new Map<string, { reached: (value: true) => void; released: Promise<true> }>();
  const answer = (request: FetchRequest): FetchResult => {
    const host = hostReach(request.url);
    if (request.reach === "public" && host === "private") {
      return { failure: { kind: "refused", refusal: "private-from-public" }, ok: false };
    }
    const route = table.get(request.url);
    if (route === undefined) {
      return {
        failure: { kind: "status", reason: "not found", status: 404, transient: false },
        ok: false,
      };
    }
    if ("failure" in route) {
      return { failure: route.failure, ok: false };
    }
    const bytes = "html" in route ? new TextEncoder().encode(route.html) : route.bytes;
    return {
      ok: true,
      response: {
        bytes,
        charset: "utf-8",
        mediaType: "html" in route ? "text/html" : route.mediaType,
        reach: request.reach ?? host,
        status: 200,
        truncated: "truncated" in route && route.truncated === true,
        url: request.url,
      },
    };
  };
  return {
    async fetch(request) {
      requests.push(request.url);
      reaches.push({ reach: request.reach, url: request.url });
      const held = holds.get(request.url);
      if (held !== undefined) {
        holds.delete(request.url);
        held.reached(true);
        await held.released;
      }
      return answer(request);
    },
    hold(url) {
      const reached = Promise.withResolvers<true>();
      const released = Promise.withResolvers<true>();
      holds.set(url, { reached: reached.resolve, released: released.promise });
      return {
        reached: reached.promise,
        release: () => {
          released.resolve(true);
        },
      };
    },
    reachOf: async (url) => await Promise.resolve({ ok: true, reach: hostReach(url) }),
    reaches,
    requests,
    routes: table,
  };
};

const match = (html: string, pattern: RegExp): string | null =>
  pattern.exec(html)?.groups?.value ?? null;

// the tiny pages a capture suite serves: <title>, og:site_name, og:image, the description meta and
// <p> paragraphs, read by pattern, and for a copy its stylesheet links and <img> pictures
const fakeExtract = (job: FillJobInput): FillResult => {
  switch (job.kind) {
    case "extract": {
      const paragraphs = [...job.html.matchAll(/<p>(?<text>[^<]*)<\/p>/gu)].map(
        (p) => p.groups?.text ?? "",
      );
      const description = match(job.html, /<meta name="description" content="(?<value>[^"]*)"/u);
      let article = paragraphs.length === 0 ? "" : `${paragraphs.join("\n\n")}\n`;
      if (job.prefer === "description" && description !== null) {
        article = `${description}\n`;
      }
      return {
        article,
        facts: {
          author: null,
          description,
          images: [
            ...job.html.matchAll(/<meta property="og:image" content="(?<value>[^"]*)"/gu),
          ].map((image) => image.groups?.value ?? ""),
          lang: null,
          oembed: null,
          published: null,
          site: match(job.html, /<meta property="og:site_name" content="(?<value>[^"]*)"/u),
          title: match(job.html, /<title>(?<value>[^<]*)<\/title>/u),
        },
        kept: 1,
        kind: "extracted",
        rung: "rich",
      };
    }
    case "copy-plan": {
      return {
        images: [...job.html.matchAll(/<img src="(?<value>[^"]*)"/gu)].map(
          (image) => image.groups?.value ?? "",
        ),
        kind: "copy-plan",
        styleImports: [],
        styleRefs: [],
        stylesheets: [...job.html.matchAll(/<link rel="stylesheet" href="(?<value>[^"]*)"/gu)].map(
          (sheet) => sheet.groups?.value ?? "",
        ),
      };
    }
    case "copy-build": {
      return { html: `<!DOCTYPE html>\n<p>copy of ${job.url}</p>\n`, kind: "copy" };
    }
    default: {
      const exhaustive: never = job;
      return exhaustive;
    }
  }
};

// a PNG header that reads as `width` by `height`: enough for the sniff and the size check
export const pngOf = (width: number, height: number, salt = 0): Uint8Array => {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[40] = salt;
  return bytes;
};

export interface RecordedPlacement {
  path: string;
  itemId: string | null;
  final: boolean;
}

// the real store writes, with the placement the real one makes for a final fill: every waiting
// quote under a Highlights section
const recordingAnnotations = (
  real: AnnotationsService,
  core: Pick<ItemCore, "read">,
  onPlace: (placement: RecordedPlacement) => void = () => {},
) => {
  const placements: RecordedPlacement[] = [];
  const quotes: string[] = [];
  const annotations: Pick<AnnotationsService, "add" | "list" | "placeWaiting"> = {
    add: async (request) => {
      if (request.place !== undefined) {
        const item = await core.read(request.path);
        if (item === null || !item.content.includes(request.quote)) {
          throw new AnnotationsError("passage-not-found", "That passage isn't in the item's text.");
        }
        const { place: _place, ...stored } = request;
        return await real.add(stored);
      }
      quotes.push(request.quote);
      return await real.add(request);
    },
    list: async (path) => await real.list(path),
    placeWaiting: async (args) => {
      placements.push({ final: args.final, itemId: args.itemId, path: args.path });
      onPlace({ final: args.final, itemId: args.itemId, path: args.path });
      if (!args.final || quotes.length === 0) {
        return await Promise.resolve({ content: args.content, placed: [] });
      }
      const section = quotes.map((quote) => `> ${quote}`).join("\n\n");
      quotes.length = 0;
      return {
        content: `${args.content.trimEnd()}\n\n## Highlights\n\n${section}\n`,
        placed: ["x"],
      };
    },
  };
  return { annotations, placements };
};

export interface CaptureSuite {
  harness: BootedTestApp;
  capture: Capture;
  clock: ManualClock;
  fetcher: FakeFetcher;
  core: ItemCore;
  placements: RecordedPlacement[];
  onDisk: (path: string) => string;
  // a capture over the same server and database: what the next boot of the server would be
  restart: () => Capture;
}

export const bootCapture = async (
  options: {
    routes?: Record<string, Route>;
    core?: (core: ItemCore) => ItemCore;
    onPlace?: (placement: RecordedPlacement) => void;
  } = {},
): Promise<CaptureSuite> => {
  const harness = await bootTestApp();
  const realCore = harness.composed.context.items.core;
  const core = options.core?.(realCore) ?? realCore;
  const clock = manualClock();
  const fetcher = fakeFetcher(options.routes);
  const { annotations, placements } = recordingAnnotations(
    harness.composed.context.annotations,
    core,
    options.onPlace,
  );
  const make = (): Capture =>
    createCapture({
      annotations,
      core,
      dataDir: harness.dataDir,
      db: harness.db,
      debugLog: undefined,
      downscale: createImageDownscale({ platform: "linux" }),
      knowledge: harness.composed.context.knowledge,
      ownPort: () => null,
      ports: { clock, fetcher, runner: inlineFillRunner(fakeExtract) },
      version: "9.9.9",
    });
  const captures: Capture[] = [make()];
  const [capture] = captures;
  if (capture === undefined) {
    throw new Error("no capture");
  }
  // first: a fill stopping writes the vault and the database, which later steps close
  harness.composed.teardown.unshift({
    name: "capture-suite",
    run: async () => {
      for (const made of captures) {
        await made.dispose();
      }
    },
  });
  return {
    capture,
    clock,
    core,
    fetcher,
    harness,
    onDisk: (path) => readFileSync(nodePath.join(harness.vaultDir, path), "utf-8"),
    placements,
    restart: () => {
      const next = make();
      captures.push(next);
      return next;
    },
  };
};
