// "Keep a copy of the page": the worker plans what the copy needs, this fetches it through the
// guard under the page's own reach (four at a time; at most 64 stylesheets and 64 more they
// import, a stylesheet 1 MiB and all of them 3 MiB; at most 400 pictures and fonts, a picture
// 2 MiB, a font 512 KiB; 9 MiB and 45 s in all, and nothing new asked once those 45 s are up),
// the worker builds the one script-free file, and it is stored by its hash under assets/pages/.

import { PAGES_DIR } from "@repo/notes/items/item-kind";
import { sniffMedia } from "@repo/notes/items/sniff-media";
import { decodeText } from "@repo/notes/text/decode-text";

import type { ItemCore } from "../item-core";
import type { Reach } from "./address-guard";
import { cssImports, cssReferences } from "./css-urls";
import type { CopyResourceKind, CssReference } from "./css-urls";
import type { CopyFile } from "./fill-protocol";
import type { FillRunner } from "./fill-runner";
import type { GuardedFetch } from "./guarded-fetch";

const KiB = 1024;
const MiB = 1024 * KiB;
const CSS_MAX_BYTES = MiB;
const CSS_TOTAL_MAX_BYTES = 3 * MiB;
// a page names as many as it likes, and each is a lookup and a dial
const STYLESHEETS_MAX = 64;
const RESOURCES_MAX = 400;
const LIMITS: Record<CopyResourceKind, number> = { font: 512 * KiB, image: 2 * MiB };
const RESOURCES_TOTAL_MAX_BYTES = 9 * MiB;
const BUDGET_MS = 45_000;
const CONCURRENCY = 4;
const COPY_MAX_BYTES = 10 * MiB;

export type PageCopy =
  | { kind: "copy"; path: string; wrote: boolean }
  | { kind: "too-big" }
  | { kind: "failed" };

interface CopyDeps {
  fetcher: GuardedFetch;
  runner: FillRunner;
  core: Pick<ItemCore, "writeContentAddressed">;
}

// `run` over every item, at most `limit` at once, in order of start
const pooled = async <T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>) => {
  let next = 0;
  const lane = async (): Promise<void> => {
    for (let index = next; index < items.length; index = next) {
      next += 1;
      const item = items[index];
      if (item !== undefined) {
        await run(item);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
};

const FONT_TYPES: readonly [string, string][] = [
  ["wOF2", "font/woff2"],
  ["wOFF", "font/woff"],
  ["OTTO", "font/otf"],
];

// a font's type by its first bytes; a site's own claim of a font type is not trusted alone
const fontType = (bytes: Uint8Array): string | null => {
  const tag = String.fromCodePoint(...bytes.subarray(0, 4));
  const named = FONT_TYPES.find(([signature]) => signature === tag)?.[1];
  if (named !== undefined) {
    return named;
  }
  return bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0 ? "font/ttf" : null;
};

const dataUriOf = (kind: CopyResourceKind, bytes: Uint8Array): string | null => {
  const type = kind === "font" ? fontType(bytes) : sniffMedia(bytes)?.mediaType;
  if (type === null || type === undefined || type === "application/pdf") {
    return null;
  }
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
};

interface Stylesheet {
  url: string;
  css: string;
}

const fetchStylesheets = async (
  urls: readonly string[],
  context: { deps: CopyDeps; reach: Reach; signal: AbortSignal; budget: { css: number } },
): Promise<Stylesheet[]> => {
  const sheets: Stylesheet[] = [];
  await pooled([...new Set(urls)].slice(0, STYLESHEETS_MAX), CONCURRENCY, async (url) => {
    if (context.budget.css >= CSS_TOTAL_MAX_BYTES || context.signal.aborted) {
      return;
    }
    const fetched = await context.deps.fetcher.fetch({
      accept: "text/css,*/*;q=0.1",
      maxBytes: Math.min(CSS_MAX_BYTES, CSS_TOTAL_MAX_BYTES - context.budget.css),
      overflow: "refuse",
      reach: context.reach,
      signal: context.signal,
      url,
    });
    if (!fetched.ok) {
      return;
    }
    context.budget.css += fetched.response.bytes.byteLength;
    sheets.push({ css: decodeText(fetched.response.bytes, fetched.response.charset), url });
  });
  return sheets;
};

export const keepPageCopy = async (
  deps: CopyDeps,
  args: { html: string; url: string; reach: Reach; savedOn: string; signal: AbortSignal },
): Promise<PageCopy> => {
  const plan = await deps.runner.run({ html: args.html, kind: "copy-plan", url: args.url });
  if (plan.kind !== "copy-plan") {
    return { kind: "failed" };
  }
  const signal = AbortSignal.any([args.signal, AbortSignal.timeout(BUDGET_MS)]);
  const context = { budget: { css: 0 }, deps, reach: args.reach, signal };
  const linked = await fetchStylesheets([...plan.stylesheets, ...plan.styleImports], context);
  // one level of @import below each stylesheet the page names
  const imported = await fetchStylesheets(
    linked.flatMap((sheet) => cssImports(sheet.css, sheet.url)),
    context,
  );
  const sheets = [...linked, ...imported];
  const wanted = new Map<string, CopyResourceKind>();
  const want = (reference: CssReference): void => {
    if (wanted.get(reference.url) !== "font") {
      wanted.set(reference.url, reference.kind);
    }
  };
  for (const url of plan.images) {
    want({ kind: "image", url });
  }
  for (const reference of [
    ...plan.styleRefs,
    ...sheets.flatMap((sheet) => cssReferences(sheet.css, sheet.url)),
  ]) {
    want(reference);
  }
  const files: CopyFile[] = [];
  let total = 0;
  await pooled([...wanted].slice(0, RESOURCES_MAX), CONCURRENCY, async ([url, kind]) => {
    if (total >= RESOURCES_TOTAL_MAX_BYTES || signal.aborted) {
      return;
    }
    const fetched = await deps.fetcher.fetch({
      accept: kind === "font" ? "font/woff2,font/woff,*/*;q=0.1" : "image/*,*/*;q=0.1",
      maxBytes: Math.min(LIMITS[kind], RESOURCES_TOTAL_MAX_BYTES - total),
      overflow: "refuse",
      reach: args.reach,
      signal,
      url,
    });
    if (!fetched.ok) {
      return;
    }
    const { bytes } = fetched.response;
    const dataUri = dataUriOf(kind, bytes);
    if (dataUri === null) {
      return;
    }
    total += bytes.byteLength;
    files.push({ bytes: bytes.byteLength, dataUri, kind, url });
  });
  if (args.signal.aborted) {
    return { kind: "failed" };
  }
  const built = await deps.runner.run({
    files,
    html: args.html,
    kind: "copy-build",
    maxBytes: COPY_MAX_BYTES,
    savedOn: args.savedOn,
    stylesheets: sheets,
    url: args.url,
  });
  if (built.kind === "copy-too-big") {
    return { kind: "too-big" };
  }
  if (built.kind !== "copy") {
    return { kind: "failed" };
  }
  const written = await deps.core.writeContentAddressed(
    PAGES_DIR,
    "html",
    new TextEncoder().encode(built.html),
  );
  return { kind: "copy", path: written.path, wrote: written.wrote };
};
