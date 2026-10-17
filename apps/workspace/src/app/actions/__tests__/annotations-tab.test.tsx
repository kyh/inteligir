// @vitest-environment jsdom

import type { AnnotationWire } from "@repo/contract/local/annotations/annotations-schema";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { stubRpc } from "../../__tests__/rpc-stub";
import { createWorkspaceQueryClient } from "../../workspace-context";
import { AnnotationsTab } from "../annotations-tab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// the wire's own shape, spelled without its optional keys so it is plain JSON for the stub
const annotation = (
  id: string,
  state: AnnotationWire["state"],
  fields: { passage?: string | null; quote?: string | null; text?: string } = {},
) => ({
  id,
  passage: fields.passage ?? null,
  quote: fields.quote ?? null,
  replies: [],
  root: { createdAt: 1_760_000_000, text: fields.text ?? "", updatedAt: 1_760_000_000 },
  state,
});

type AnnotationRow = ReturnType<typeof annotation>;

const listing = (annotations: AnnotationRow[]) => ({
  annotations,
  orphanMarkers: [],
  path: "plan.md",
  strayIds: [],
  total: annotations.length,
});

const editSchema = z.object({ id: z.string(), path: z.string(), text: z.string() });

const mountTab = (annotations: AnnotationRow[]) => {
  installFakeEditorHost();
  const edits: z.infer<typeof editSchema>[] = [];
  stubRpc({
    "annotations/edit": (input) => {
      edits.push(editSchema.parse(input));
      return listing(annotations);
    },
    "annotations/list": () => listing(annotations),
  });
  render(
    <QueryClientProvider client={createWorkspaceQueryClient()}>
      <AnnotationsTab docPath="plan.md" focus={null} modifier="meta" />
    </QueryClientProvider>,
  );
  return { edits };
};

describe("the Annotations tab", () => {
  it("says how to make the first highlight, spelling the chord", async () => {
    mountTab([]);
    expect(await screen.findByText("No highlights yet. Select text and press ⇧⌘H.")).toBeTruthy();
  });

  it("lists the anchored ones as the server orders them, the live passage before the quote", async () => {
    mountTab([
      annotation("a1", "anchored", { passage: "first words, as they read now", quote: "first" }),
      annotation("a2", "anchored", { quote: "second words" }),
    ]);

    const first = await screen.findByText("first words, as they read now");
    const second = screen.getByText("second words");
    expect(first.compareDocumentPosition(second)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(first.className).toContain("bg-highlight");
    expect(screen.getAllByRole("button", { name: "Remove highlight" })).toHaveLength(2);
  });

  it("groups the unanchored ones by why, each with Remove", async () => {
    mountTab([
      annotation("w1", "waiting", { quote: "a passage the page will hold" }),
      annotation("m1", "missing", { quote: "a passage edited away" }),
    ]);

    const waiting = await screen.findByRole("region", { name: "Waiting for the page's text" });
    const missing = screen.getByRole("region", { name: "No longer in the text" });
    expect(within(waiting).getByText("a passage the page will hold")).toBeTruthy();
    expect(within(missing).getByText("a passage edited away")).toBeTruthy();
    expect(within(waiting).getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(within(missing).getByRole("button", { name: "Remove" })).toBeTruthy();
  });

  it("edits a note in place on a click, writing it on Return", async () => {
    const { edits } = mountTab([annotation("a1", "anchored", { quote: "words", text: "old" })]);

    fireEvent.click(await screen.findByRole("button", { name: "Edit the note" }));
    const field = screen.getByLabelText("Note");
    fireEvent.change(field, { target: { value: "new note" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => {
      expect(edits).toEqual([{ id: "a1", path: "plan.md", text: "new note" }]);
    });
  });
});
