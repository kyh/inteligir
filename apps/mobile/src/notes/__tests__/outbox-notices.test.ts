import { VAULT_FILE_MAX_BYTES } from "@repo/api/cloud/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { outboxNotices, PARKED_ACTION_LABELS } from "../outbox-notices";
import { createFakeVault, networkOver } from "./fake-vault";
import type { Network } from "./fake-vault";
import { launchPhone } from "./phone-storage";

describe("what the notes screens show of the phone's unsent edits", () => {
  it("offers a parked note Retry, Save as new note and Discard, and tells a conflict in the outbox's own sentence", async () => {
    const vault = createFakeVault({ "Plan.md": "# Plan\n", "Trip.md": "# Trip\n" });
    const net: Network = { loseApplied: false, online: true };
    const store = launchPhone(networkOver(vault, net));
    await store.refresh();
    await store.readNote("Plan.md");
    await store.readNote("Trip.md");
    net.online = false;
    await store.write("Plan.md", `# Plan\n${"x".repeat(VAULT_FILE_MAX_BYTES)}\n`);
    await store.write("Trip.md", "# Trip\nkept\n");
    vault.change({ "Trip.md": null });

    net.online = true;
    await store.drain();

    const notices = outboxNotices(store.outbox.status.get());
    expect(notices).toMatchObject([
      {
        kind: "parked",
        reason: "This is too large to save to your vault from your phone.",
        title: "Plan is not in your vault yet",
      },
      {
        kind: "conflict",
        message: "“Trip” was deleted on Mac but edited here, so it was kept.",
        open: "Trip.md",
      },
    ]);
    const [parked] = notices;
    expect(
      parked?.kind === "parked" ? parked.actions.map((action) => PARKED_ACTION_LABELS[action]) : [],
    ).toStrictEqual(["Retry", "Save as new note", "Discard"]);
  });

  it("offers no Save as new note for a change with no text or file of its own to keep", () => {
    const [notice] = outboxNotices({
      conflicts: [],
      lastError: null,
      parked: [{ canSaveAsNew: false, paths: ["a.md", "b.md"], reason: "no", seq: 4 }],
      unsent: 1,
    });
    expect(notice).toMatchObject({ actions: ["retry", "discard"], seq: 4 });
  });

  it("names a reply or a resolve as a comment, never by its store's file", () => {
    const [notice] = outboxNotices({
      conflicts: [],
      lastError: null,
      parked: [
        {
          canSaveAsNew: false,
          paths: [".inteligir/comments/9e64c3df-c1e2-4a4d-8c07-91528f422413.json"],
          reason: "no",
          seq: 5,
        },
      ],
      unsent: 1,
    });
    expect(notice).toMatchObject({ title: "A comment is not in your vault yet" });
  });

  it("opens the copy a conflict made, where the other version is", () => {
    const [notice] = outboxNotices({
      conflicts: [{ copyPath: "Plan (conflict, Mac).md", id: 2, message: "m", path: "Plan.md" }],
      lastError: null,
      parked: [],
      unsent: 0,
    });
    expect(notice).toMatchObject({ id: 2, open: "Plan (conflict, Mac).md" });
  });
});
