// Faux-provider tests — the deterministic, login-free stub the E2E harness
// scripts. Drives real turns through pi-ai's `complete` (which dispatches
// through the api registry exactly like a live PiAgent session does): the
// default self-refilling echo answers every unscripted turn, and
// setFauxResponses stages an exact sequence including tool calls.

import { afterEach, describe, expect, it } from "vitest";
import { complete, fauxAssistantMessage, fauxText, fauxToolCall } from "@mariozechner/pi-ai";
import type { Context } from "@mariozechner/pi-ai";

import { ensureFauxProvider, resetFauxResponses, setFauxResponses } from "../faux-provider";

afterEach(() => {
  resetFauxResponses();
});

function userContext(text: string): Context {
  return { messages: [{ role: "user", content: text, timestamp: Date.now() }] };
}

function textOf(content: { type: string }[]): string {
  return content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

describe("faux provider", () => {
  it("registers once with a stable provider/api id and one model", () => {
    const reg = ensureFauxProvider();
    expect(reg).toBe(ensureFauxProvider());
    expect(reg.api).toBe("faux");
    const model = reg.getModel();
    expect(model.provider).toBe("faux");
    expect(model.id).toBe("faux-1");
  });

  it("answers unscripted turns with a deterministic echo, forever", async () => {
    const model = ensureFauxProvider().getModel();
    const first = await complete(model, userContext("hello vault"));
    expect(first.stopReason).toBe("stop");
    expect(textOf(first.content)).toBe("[faux] hello vault");
    // The default echo self-refills — a second turn still answers instead of
    // draining into pi-ai's queue-empty error.
    const second = await complete(model, userContext("second turn"));
    expect(textOf(second.content)).toBe("[faux] second turn");
  });

  it("setFauxResponses scripts an exact sequence (the E2E seam)", async () => {
    const model = ensureFauxProvider().getModel();
    setFauxResponses([
      fauxAssistantMessage("scripted reply one"),
      fauxAssistantMessage([
        fauxText("checking the box"),
        fauxToolCall("edit", { path: "vault/tasks.md" }),
      ]),
    ]);

    const first = await complete(model, userContext("anything"));
    expect(textOf(first.content)).toBe("scripted reply one");

    const second = await complete(model, userContext("anything else"));
    expect(textOf(second.content)).toBe("checking the box");
    const toolCall = second.content.find((block) => block.type === "toolCall");
    expect(toolCall).toMatchObject({ name: "edit", arguments: { path: "vault/tasks.md" } });

    // The script is drained — an over-run surfaces as an error message, never
    // a silent success.
    const third = await complete(model, userContext("over-run"));
    expect(third.stopReason).toBe("error");
    expect(third.errorMessage).toMatch(/No more faux responses/);
  });
});
