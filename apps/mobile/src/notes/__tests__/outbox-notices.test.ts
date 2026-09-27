import { VAULT_FILE_MAX_BYTES } from "@repo/api/cloud/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { outboxNotices, PARKED_ACTION_LABELS } from "../outbox-notices";
import type { OutboxStatus } from "../vault-outbox";
import { createFakeVault, networkOver } from "./fake-vault";
import type { Network } from "./fake-vault";
import { launchPhone } from "./phone-storage";

const STORE = ".inteligir/comments/9e64c3df-c1e2-4a4d-8c07-91528f422413.json";

const parkedOnly = (parked: OutboxStatus["parked"]): OutboxStatus => ({
  conflicts: [],
  lastError: null,
  parked,
  unsent: parked.length,
});

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
        discard: "It has not reached your vault, and discarding deletes it.",
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
    const [notice] = outboxNotices(
      parkedOnly([
        {
          canSaveAsNew: false,
          from: "a.md",
          kind: "rename",
          paths: ["a.md", "b.md"],
          reason: "no",
          seq: 4,
          to: "b.md",
        },
      ]),
    );
    expect(notice).toMatchObject({ actions: ["retry", "discard"], seq: 4 });
  });

  it("names a reply or a resolve as a comment, never by its store's file", () => {
    const [notice] = outboxNotices(
      parkedOnly([{ canSaveAsNew: false, kind: "comment", paths: [STORE], reason: "no", seq: 5 }]),
    );
    expect(notice).toMatchObject({ title: "A comment is not in your vault yet" });
  });

  it("says what a refused delete, rename and new comment leave, and what discarding each keeps", () => {
    const notices = outboxNotices(
      parkedOnly([
        {
          canSaveAsNew: false,
          kind: "remove",
          paths: ["Plan.md", STORE],
          reason: "no",
          seq: 1,
        },
        {
          canSaveAsNew: false,
          from: "notes/Plan.md",
          kind: "rename",
          paths: ["notes/Plan.md", "notes/Trip.md"],
          reason: "no",
          seq: 2,
          to: "notes/Trip.md",
        },
        {
          canSaveAsNew: false,
          kind: "comment",
          paths: ["Plan.md", STORE],
          reason: "no",
          seq: 3,
        },
        {
          canSaveAsNew: true,
          kind: "putAsset",
          paths: ["assets/photo.jpg"],
          reason: "no",
          seq: 4,
        },
      ]),
    );
    expect(notices).toMatchObject([
      {
        discard: "It has not reached your vault. Discarding keeps the note.",
        title: "Plan was not deleted from your vault",
      },
      {
        discard: "It has not reached your vault. Discarding keeps its old name, Plan.",
        title: "Plan was not renamed to Trip",
      },
      {
        discard: "It has not reached your vault, and discarding deletes it.",
        title: "A comment on Plan is not in your vault yet",
      },
      {
        discard: "It has not reached your vault, and discarding deletes it.",
        title: "photo.jpg is not in your vault yet",
      },
    ]);
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
