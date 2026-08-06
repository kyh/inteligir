// ---------------------------------------------------------------------------
// Deep-link capture: the grammar translation, the route's gate, and the
// exactly-once drain the host's alarm owns.
//
// The load-bearing assertion is that the WEB scheme buys nothing the URL scheme
// did not already allow — same parser, same sanitizer, same refusals — and that
// the target path is still computed host-side rather than taken from the link.
// ---------------------------------------------------------------------------

import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { matchDeepLinkPath, parseWebDeepLink } from "../capture/deep-link";
import { userHostName } from "../host/host-address";
import { authenticated, invoke, ORIGIN, signUp, WEB_ORIGIN } from "./host-helpers";

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("the web deep-link grammar", () => {
  it("matches only a POST on /v1/host/:userId/link", () => {
    expect(matchDeepLinkPath("POST", "/v1/host/user-123/link")).toBe("user-123");
    expect(matchDeepLinkPath("POST", "/v1/host/a%2Fb/link")).toBe("a/b");
    expect(matchDeepLinkPath("GET", "/v1/host/user-123/link")).toBeNull();
    expect(matchDeepLinkPath("POST", "/v1/host/user-123/ws")).toBeNull();
  });

  it("reuses the scheme's sanitizer verbatim", () => {
    // Markdown/MDX-active characters are escaped, whitespace runs collapse, and
    // the line is inert — the guard lives in @repo/bridge/deep-link, and this
    // proves the web form reaches it rather than going around it.
    expect(parseWebDeepLink("task", params("text=%5B%5Bsteal%5D%5D%20%23tag"))).toEqual({
      kind: "capture",
      capture: "task",
      text: "\\[\\[steal\\]\\] \\#tag",
    });
  });

  it("refuses everything outside the grammar", () => {
    expect(parseWebDeepLink("append", params(""))).toBeNull(); // no text
    expect(parseWebDeepLink("append", params("text=%20%20"))).toBeNull(); // nothing printable
    expect(parseWebDeepLink("search", params("q="))).toBeNull();
    expect(parseWebDeepLink("note", params("target=app.html"))).toBeNull(); // never an HTML app
    expect(parseWebDeepLink("delete", params("path=notes/a.md"))).toBeNull(); // not a verb
  });

  it("refuses `session`, which completed a DESKTOP sign-in", () => {
    // A web client is already signed in — the session is what named its object,
    // so accepting this would be a second, weaker way to authenticate.
    const code = "a".repeat(32);
    expect(parseWebDeepLink("session", params(`code=${code}&state=${code}`))).toBeNull();
  });

  it("carries a nav target through the path form the parser reads", () => {
    expect(parseWebDeepLink("note", params("target=notes%2Fideas.md"))).toEqual({
      kind: "nav",
      nav: { kind: "note", target: "notes/ideas.md" },
    });
    expect(parseWebDeepLink("today", params(""))).toEqual({ kind: "nav", nav: { kind: "today" } });
  });
});

async function postLink(
  account: { userId: string; token: string },
  query: string,
  init: { origin?: string | null; token?: string | null } = {},
): Promise<Response> {
  const headers = new Headers();
  const origin = init.origin === undefined ? WEB_ORIGIN : init.origin;
  if (origin !== null) headers.set("origin", origin);
  const token = init.token === undefined ? account.token : init.token;
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  const { SELF } = await import("cloudflare:test");
  return SELF.fetch(`${ORIGIN}/v1/host/${encodeURIComponent(account.userId)}/link?${query}`, {
    method: "POST",
    headers,
  });
}

describe("the deep-link route", () => {
  it("refuses an unknown origin, a missing bearer and another user's host", async () => {
    const account = await signUp("link-gate@example.com");
    const other = await signUp("link-gate-other@example.com");

    expect((await postLink(account, "verb=today", { origin: "https://evil.example" })).status).toBe(
      403,
    );
    expect((await postLink(account, "verb=today", { origin: null })).status).toBe(403);
    expect((await postLink(account, "verb=today", { token: null })).status).toBe(401);
    // The userId is an ADDRESS: the object binds the session to its own name.
    expect((await postLink({ ...account, token: other.token }, "verb=today")).status).toBe(401);
  });

  it("lands a capture on TODAY's note, at a path the URL never named", async () => {
    const account = await signUp("link-capture@example.com");
    const { ws, frames } = await authenticated(account);

    const response = await postLink(account, "verb=task&text=call%20the%20vet");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: "capture" });

    // The offer reaches the open editor first — the only path with no
    // lost-update window against a dirty buffer.
    let applied: { id: string; path: string; line: string } | null = null;
    for (;;) {
      const frame = await frames.next();
      if (frame.t === "evt" && frame.method === "onCaptureApply") {
        applied = frame.payload as { id: string; path: string; line: string };
        break;
      }
    }
    expect(applied.line).toBe("- [ ] call the vet");
    expect(applied.path).toMatch(/^journal\/\d{4}-\d{2}-\d{2}\.md$/);

    // Nobody applied it, so the alarm drains it to the note.
    const stub = env.UserHost.getByName(userHostName(account.userId));
    await runInDurableObject(stub, async (host) => {
      await host.captureInbox.sweep(Date.now() + 60_000);
    });
    const read = await invoke(ws, frames, 10, "readVaultDoc", { path: applied.path });
    expect(read.ok && String(read.result)).toContain("- [ ] call the vet");
    ws.close();
  });

  it("appends a capture exactly once however many times the drain runs", async () => {
    const account = await signUp("link-once@example.com");
    const { ws, frames } = await authenticated(account);
    await postLink(account, "verb=append&text=one%20idea");

    const stub = env.UserHost.getByName(userHostName(account.userId));
    // At-least-once alarm delivery is the case this must survive: the exact-line
    // dedupe is what makes a re-drain a no-op rather than a duplicate.
    await runInDurableObject(stub, async (host) => {
      await host.captureInbox.sweep(Date.now() + 60_000);
      await host.captureInbox.sweep(Date.now() + 60_000);
      await host.captureInbox.sweep(Date.now() + 60_000);
    });

    const listed = await invoke(ws, frames, 20, "listVault");
    const daily = (listed.ok ? listed.result : []) as { path: string }[];
    const journal = daily.find((entry) => entry.path.startsWith("journal/"));
    expect(journal).toBeDefined();
    const read = await invoke(ws, frames, 21, "readVaultDoc", { path: journal?.path });
    const matches = String(read.ok ? read.result : "").match(/- one idea/g) ?? [];
    expect(matches).toHaveLength(1);
    ws.close();
  });

  it("keeps a deferred capture until the client re-acks", async () => {
    const account = await signUp("link-deferred@example.com");
    const { ws, frames } = await authenticated(account);
    const response = await postLink(account, "verb=append&text=later");
    const { id } = (await response.json()) as { id: string };

    await invoke(ws, frames, 30, "ackCapture", { id, outcome: "deferred" });
    const stub = env.UserHost.getByName(userHostName(account.userId));
    await runInDurableObject(stub, async (host) => {
      // A parked entry has no deadline, so the sweep leaves it alone.
      expect(host.captureInbox.nextDueAt()).toBeNull();
      await host.captureInbox.sweep(Date.now() + 60_000);
    });

    await invoke(ws, frames, 31, "ackCapture", { id, outcome: "not-open" });
    const listed = await invoke(ws, frames, 32, "listVault");
    const entries = (listed.ok ? listed.result : []) as { path: string }[];
    expect(entries.some((entry) => entry.path.startsWith("journal/"))).toBe(true);
    ws.close();
  });

  it("parks a nav for a client that has not connected yet, and clears it on the pull", async () => {
    const account = await signUp("link-nav@example.com");
    await postLink(account, "verb=search&q=meeting%20notes");

    const { ws, frames } = await authenticated(account);
    const pulled = await invoke(ws, frames, 40, "takePendingDeepLinkNav");
    expect(pulled.ok && pulled.result).toMatchObject({
      nav: { kind: "search", query: "meeting notes" },
    });
    // Pull-and-CLEAR: a nav must not replay on every reconnect.
    const again = await invoke(ws, frames, 41, "takePendingDeepLinkNav");
    expect(again.ok && again.result).toBeNull();
    ws.close();
  });

  it("wakes the host on its own alarm to drain an unanswered capture", async () => {
    const account = await signUp("link-alarm@example.com");
    await postLink(account, "verb=append&text=unanswered");
    const stub = env.UserHost.getByName(userHostName(account.userId));
    // The ack deadline joined the object's ONE alarm rather than arming a
    // second one — a pending timer would pin the object it exists to let sleep.
    await runInDurableObject(stub, (host) => {
      expect(host.captureInbox.nextDueAt()).not.toBeNull();
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
  });
});
