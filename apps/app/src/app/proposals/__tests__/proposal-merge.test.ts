// What an ACCEPT does to a note the user was editing at the time.
//
// The accept lands on disk through the vault's CAS and comes back to this
// client as an ordinary external change — so the machinery that reconciles it
// is the note controller's, unchanged, and the case worth pinning is the one
// the review layer makes newly likely: the user has unsaved edits in the same
// region the suggestion rewrites.
//
// The CAS is what makes this a diff3 and not a clobber. A user edit that was
// SAVED moves disk off the proposal's base, and the accept is refused (the
// server suite covers that). Only an UNSAVED edit leaves disk matching the
// base, and then the accepted bytes arrive under a dirty buffer — which is
// exactly diff3's job: the buffer wins the overlap and the conflict is
// reported.

import { describe, expect, it, vi } from "vitest";
import { NoteController, type NoteBuffer } from "../../note/note-controller";

class FakeBuffer implements NoteBuffer {
  constructor(public content: string) {}

  getDoc(): string {
    return this.content;
  }

  replaceDoc(next: string): void {
    this.content = next;
  }
}

const BASE = ["# Notes", "", "alpha", "beta", "gamma", "delta", "epsilon"].join("\n");

function controllerOver(buffer: FakeBuffer) {
  const onConflict = vi.fn();
  const controller = new NoteController({
    buffer,
    initialContent: BASE,
    save: () => Promise.resolve({ ok: true }),
    onConflict,
    onSaveError: () => {},
  });
  return { controller, onConflict };
}

describe("an accepted suggestion arriving under an unsaved edit", () => {
  it("MERGES when a stable line separates the two edits", () => {
    const buffer = new FakeBuffer(
      ["# Notes", "", "alpha", "BETA (mine)", "gamma", "delta", "epsilon"].join("\n"),
    );
    const { controller, onConflict } = controllerOver(buffer);

    // The agent's suggestion, accepted: it rewrote a line two below mine.
    controller.externalContent(
      ["# Notes", "", "alpha", "beta", "gamma", "DELTA (agent)", "epsilon"].join("\n"),
    );

    expect(buffer.content).toBe(
      ["# Notes", "", "alpha", "BETA (mine)", "gamma", "DELTA (agent)", "epsilon"].join("\n"),
    );
    expect(onConflict).not.toHaveBeenCalled();
  });

  it("KEEPS THE BUFFER and reports the conflict when both rewrote the same region", () => {
    const buffer = new FakeBuffer(
      ["# Notes", "", "alpha", "BETA (mine)", "gamma", "delta", "epsilon"].join("\n"),
    );
    const { controller, onConflict } = controllerOver(buffer);

    controller.externalContent(
      ["# Notes", "", "alpha", "BETA (agent)", "gamma", "delta", "epsilon"].join("\n"),
    );

    // The user's work is never the thing that loses — the suggestion can be
    // re-run, an unsaved keystroke cannot.
    expect(buffer.content).toContain("BETA (mine)");
    expect(buffer.content).not.toContain("BETA (agent)");
    expect(onConflict).toHaveBeenCalledTimes(1);
  });

  it("treats ADJACENT edits as one region, and the buffer still wins it", () => {
    // Classic diff3: two changed runs with no stable line between them cannot
    // be interleaved unambiguously, so they group. Worth pinning rather than
    // discovering — an accepted suggestion one line from the user's cursor is
    // the likeliest overlap this whole layer produces, and it is a CONFLICT
    // here even though the two edits never touched the same line.
    const buffer = new FakeBuffer(
      ["# Notes", "", "alpha", "BETA (mine)", "gamma", "delta", "epsilon"].join("\n"),
    );
    const { controller, onConflict } = controllerOver(buffer);

    controller.externalContent(
      ["# Notes", "", "alpha", "beta", "GAMMA (agent)", "delta", "epsilon"].join("\n"),
    );

    expect(buffer.content).toContain("BETA (mine)");
    expect(buffer.content).not.toContain("GAMMA (agent)");
    expect(onConflict).toHaveBeenCalledTimes(1);
  });

  it("adopts the accepted bytes outright when the buffer was clean", () => {
    const buffer = new FakeBuffer(BASE);
    const { controller, onConflict } = controllerOver(buffer);
    const accepted = ["# Notes", "", "ALPHA", "beta", "gamma", "delta", "epsilon"].join("\n");

    controller.externalContent(accepted);

    expect(buffer.content).toBe(accepted);
    expect(onConflict).not.toHaveBeenCalled();
    expect(controller.isDirty()).toBe(false);
  });

  it("leaves the merged result DIRTY, so the next quiet period saves it back", () => {
    const buffer = new FakeBuffer(
      ["# Notes", "", "alpha", "BETA (mine)", "gamma", "delta", "epsilon"].join("\n"),
    );
    const { controller } = controllerOver(buffer);

    controller.externalContent(
      ["# Notes", "", "alpha", "beta", "gamma", "DELTA (agent)", "epsilon"].join("\n"),
    );

    // The merge is neither side, so it is unsaved work by construction — and
    // the editor's marks read that as unplaceable until it lands.
    expect(controller.isDirty()).toBe(true);
  });
});
