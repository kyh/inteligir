// Runtime surface test — the vendored `resources/html-app-runtime/runtime.js`
// is the app-facing half of the broker contract (CLAUDE.md § HTML Apps — the
// injected-deps + broker contract is append-only). It's plain ES5-ish
// vanilla JS with no module system, so we eval it into a jsdom window and drive
// the postMessage RPC by hand: outbound requests are captured (window.parent ===
// window in jsdom, so window.postMessage is the wire), inbound responses are
// dispatched as message events. This also pins the append-only additions —
// `list(options)` forwarding and `backlinks` + `safeBacklinks`.

import runtimeSource from "../../resources/html-app-runtime/runtime.js?raw";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type Posted = { type: string; id: string; token: string; method: string; args: unknown[] };

const posted: Posted[] = [];

// The methods we invoke are named (never undefined); the dynamic `files[name]`
// lookups in the surface test read through the index signature (so they're
// checked with `typeof`, never invoked).
type BrokerFn = (...args: unknown[]) => Promise<unknown>;
type FileApi = {
  list(options?: unknown): Promise<unknown>;
  backlinks(path: string): Promise<unknown>;
  safeBacklinks(path: string): Promise<unknown>;
} & Record<string, BrokerFn | undefined>;

function fileApi(): FileApi {
  // window.inteligir is installed by the evaluated runtime.
  return (window as unknown as { inteligir: { files: FileApi } }).inteligir.files;
}

/** Resolve the most-recent outbound request by dispatching a response event. */
function respondLatest(payload: { ok: boolean; value?: unknown; error?: string }): void {
  const last = posted[posted.length - 1];
  if (!last) throw new Error("no outbound request to respond to");
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "inteligir:response", id: last.id, ...payload },
      source: window,
    }),
  );
}

beforeAll(() => {
  window.name = "tok";
  // Capture outbound requests instead of letting jsdom deliver them — we drive
  // the responses manually. window.parent === window here, so this is the wire.
  vi.spyOn(window, "postMessage").mockImplementation((msg: unknown) => {
    posted.push(msg as Posted);
  });
  // Evaluate the IIFE against the jsdom globals (window/document/setTimeout).
  // Evaluating the SHIPPED source is the point of this suite — a hand-imported
  // module copy would test something the browser never runs.
  // oxlint-disable-next-line typescript/no-implied-eval
  new Function(runtimeSource)();
});

afterEach(() => {
  posted.length = 0;
});

describe("html-app runtime file API", () => {
  it("exposes every method plus its safe* variant, including backlinks", () => {
    const files = fileApi();
    for (const name of ["list", "read", "open", "create", "update", "remove", "backlinks"]) {
      expect(typeof files[name]).toBe("function");
      const safe = "safe" + name.charAt(0).toUpperCase() + name.slice(1);
      expect(typeof files[safe]).toBe("function");
    }
  });

  it("list() sends no args; list(options) forwards the options object", () => {
    void fileApi().list();
    expect(posted[posted.length - 1]).toMatchObject({ method: "list", token: "tok", args: [] });
    void fileApi().list({ query: "x", withProperties: true, limit: 10 });
    expect(posted[posted.length - 1]).toMatchObject({
      method: "list",
      args: [{ query: "x", withProperties: true, limit: 10 }],
    });
  });

  it("backlinks(path) forwards the path and resolves from the response", async () => {
    const promise = fileApi().backlinks("wiki/hub.md");
    expect(posted[posted.length - 1]).toMatchObject({
      method: "backlinks",
      args: ["wiki/hub.md"],
    });
    respondLatest({ ok: true, value: ["a.md", "b.md"] });
    await expect(promise).resolves.toEqual(["a.md", "b.md"]);
  });

  it("safeBacklinks wraps a rejection into { ok:false, error }", async () => {
    const promise = fileApi().safeBacklinks("wiki/hub.md");
    // safe* defers the underlying call by a microtask, so let the request post
    // before we answer it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    respondLatest({ ok: false, error: "boom" });
    await expect(promise).resolves.toEqual({ ok: false, error: "boom" });
  });
});
