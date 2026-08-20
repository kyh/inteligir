// @vitest-environment jsdom

// The open note has ONE reader. A doc-change event used to be answered twice
// — react-query's `vaultFile` invalidation and this reader — so every write
// cost the note two reads of the same bytes. The count is the assertion here,
// which is why the client is the REAL typed one over a stub fetch: a mock of
// the client could not tell one request from two.

import { createApiClient, type ApiClient } from "@repo/server-contract/client";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNoteDisk } from "../note-disk";
import type { ApiErrorResponse } from "@repo/server-contract/errors";
import type { DocEvents } from "../../workspace-context";

afterEach(cleanup);

const PATH = "notes/open.md";

/** The vault read route's own two answers: the file, or a refusal. */
type VaultFileBody = { path: string | null; content: string } | ApiErrorResponse;

function jsonResponse(body: VaultFileBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface FakeVault {
  api: ApiClient;
  /** Every GET of the file route, since mount. */
  reads: () => number;
  paths: () => readonly string[];
  setContent: (content: string) => void;
  setStatus: (status: number) => void;
  /** Holds every subsequent read open until `release` — the only way to put a
   *  second event on the wire WHILE a read is in flight. */
  hold: () => void;
  release: () => void;
}

function createFakeVault(initial: string): FakeVault {
  let content = initial;
  let status = 200;
  let holding = false;
  const requested: string[] = [];
  const held: (() => void)[] = [];

  const api = createApiClient("http://local.test", {
    fetch: async (input) => {
      const href = input instanceof URL ? input.href : input instanceof Request ? input.url : input;
      const url = new URL(href);
      if (url.pathname !== "/api/v1/vault/file") {
        throw new Error(`unexpected request to ${url.pathname}`);
      }
      requested.push(url.searchParams.get("path") ?? "");
      if (holding) {
        await new Promise<void>((resolve) => held.push(resolve));
      }
      if (status !== 200) {
        return jsonResponse(
          { error: status === 404 ? "not_found" : "internal", message: "no" },
          status,
        );
      }
      return jsonResponse({ path: url.searchParams.get("path"), content }, 200);
    },
  });

  return {
    api,
    reads: () => requested.length,
    paths: () => requested,
    setContent: (next) => {
      content = next;
    },
    setStatus: (next) => {
      status = next;
    },
    hold: () => {
      holding = true;
    },
    release: () => {
      holding = false;
      while (held.length > 0) {
        held.pop()?.();
      }
    },
  };
}

interface FakeDocEvents {
  docEvents: DocEvents;
  emit: (docId: string | null) => void;
}

function createDocEvents(): FakeDocEvents {
  const listeners = new Set<(docId: string | null) => void>();
  return {
    docEvents: {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    emit: (docId) => {
      for (const listener of listeners) {
        listener(docId);
      }
    },
  };
}

/** Lets every queued microtask (the read, its json(), the setState) land. */
const settle = (): Promise<void> => act(async () => {});

function mountReader(vault: FakeVault, hub: FakeDocEvents, onVanished = vi.fn()) {
  const rendered = renderHook(() =>
    useNoteDisk({ api: vault.api, docEvents: hub.docEvents, path: PATH, onVanished }),
  );
  return { ...rendered, onVanished };
}

describe("the open note's reader", () => {
  it("loads the note with a single read", async () => {
    const vault = createFakeVault("hello\n");
    const hub = createDocEvents();
    const { result } = mountReader(vault, hub);

    expect(result.current.content).toBeNull();
    await settle();

    expect(result.current.content).toBe("hello\n");
    expect(vault.reads()).toBe(1);
    expect(vault.paths()).toEqual([PATH]);
  });

  it("answers a doc-change event with exactly ONE read", async () => {
    const vault = createFakeVault("hello\n");
    const hub = createDocEvents();
    const { result } = mountReader(vault, hub);
    await settle();
    expect(vault.reads()).toBe(1);

    vault.setContent("hello, disk\n");
    await act(async () => {
      hub.emit(PATH);
    });

    expect(vault.reads()).toBe(2);
    expect(result.current.content).toBe("hello, disk\n");
  });

  it("collapses a burst arriving during a read into one trailing re-read", async () => {
    const vault = createFakeVault("hello\n");
    const hub = createDocEvents();
    const { result } = mountReader(vault, hub);
    await settle();

    vault.hold();
    await act(async () => {
      hub.emit(PATH);
    });
    // Three more events land while the first read is still open.
    await act(async () => {
      hub.emit(PATH);
      hub.emit(null);
      hub.emit(PATH);
    });
    vault.setContent("final\n");
    vault.release();
    await settle();

    // 1 mount + 1 held + 1 trailing, never one per event.
    expect(vault.reads()).toBe(3);
    expect(result.current.content).toBe("final\n");
  });

  it("ignores an event naming another note", async () => {
    const vault = createFakeVault("hello\n");
    const hub = createDocEvents();
    mountReader(vault, hub);
    await settle();

    await act(async () => {
      hub.emit("notes/other.md");
    });

    expect(vault.reads()).toBe(1);
  });

  it("re-reads for a folder above the note, and for an unnamed change", async () => {
    const vault = createFakeVault("hello\n");
    const hub = createDocEvents();
    mountReader(vault, hub);
    await settle();

    await act(async () => {
      hub.emit("notes");
    });
    await act(async () => {
      hub.emit(null);
    });

    expect(vault.reads()).toBe(3);
  });
});

describe("the 404 verdict", () => {
  it("reports a note deleted under us", async () => {
    const vault = createFakeVault("hello\n");
    const hub = createDocEvents();
    const { onVanished } = mountReader(vault, hub);
    await settle();

    vault.setStatus(404);
    await act(async () => {
      hub.emit(PATH);
    });

    expect(onVanished).toHaveBeenCalledTimes(1);
  });

  it("stays silent while OUR rename is in flight", async () => {
    const vault = createFakeVault("hello\n");
    const hub = createDocEvents();
    const { result, onVanished } = mountReader(vault, hub);
    await settle();

    // The rename gate: the old path 404s by design from here until the path
    // changes, and that must never read as an external delete.
    act(() => {
      result.current.setRenamePending(true);
    });
    vault.setStatus(404);
    await act(async () => {
      hub.emit(PATH);
    });

    expect(onVanished).not.toHaveBeenCalled();
    expect(result.current.content).toBe("hello\n");
  });

  it("reports again once a failed rename clears the flag", async () => {
    const vault = createFakeVault("hello\n");
    const hub = createDocEvents();
    const { result, onVanished } = mountReader(vault, hub);
    await settle();

    act(() => {
      result.current.setRenamePending(true);
    });
    act(() => {
      result.current.setRenamePending(false);
    });
    vault.setStatus(404);
    await act(async () => {
      hub.emit(PATH);
    });

    expect(onVanished).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good bytes when a re-read fails for another reason", async () => {
    const vault = createFakeVault("hello\n");
    const hub = createDocEvents();
    const { result, onVanished } = mountReader(vault, hub);
    await settle();

    vault.setStatus(500);
    await act(async () => {
      hub.emit(PATH);
    });

    expect(result.current.content).toBe("hello\n");
    expect(result.current.failed).toBe(false);
    expect(onVanished).not.toHaveBeenCalled();
  });

  it("reports a failure for a note that never opened", async () => {
    const vault = createFakeVault("hello\n");
    vault.setStatus(500);
    const hub = createDocEvents();
    const { result } = mountReader(vault, hub);
    await settle();

    expect(result.current.content).toBeNull();
    expect(result.current.failed).toBe(true);
  });
});

describe("switching notes", () => {
  it("never shows the previous note's bytes under the new path", async () => {
    const vault = createFakeVault("first\n");
    const hub = createDocEvents();
    const onVanished = vi.fn();
    const { result, rerender } = renderHook(
      ({ path }) => useNoteDisk({ api: vault.api, docEvents: hub.docEvents, path, onVanished }),
      { initialProps: { path: PATH } },
    );
    await settle();
    expect(result.current.content).toBe("first\n");

    vault.setContent("second\n");
    rerender({ path: "notes/next.md" });

    // The very render that changes the path already reads as unloaded.
    expect(result.current.content).toBeNull();
    await settle();
    expect(result.current.content).toBe("second\n");
  });

  it("reports a failure on the new path instead of keeping the old bytes", async () => {
    const vault = createFakeVault("first\n");
    const hub = createDocEvents();
    const onVanished = vi.fn();
    const { result, rerender } = renderHook(
      ({ path }) => useNoteDisk({ api: vault.api, docEvents: hub.docEvents, path, onVanished }),
      { initialProps: { path: PATH } },
    );
    await settle();

    vault.setStatus(500);
    rerender({ path: "notes/next.md" });
    await settle();

    expect(result.current.content).toBeNull();
    expect(result.current.failed).toBe(true);
  });
});
