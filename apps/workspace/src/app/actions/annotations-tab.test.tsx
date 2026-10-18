// @vitest-environment jsdom

import type { AnnotationWire } from "@repo/contract/local/annotations/annotations-schema";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { stubRpc } from "../test-support/rpc-stub";
import { orpc } from "../api";
import { createWorkspaceQueryClient } from "../workspace-context";
import { AnnotationsTab } from "./annotations-tab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

const listing = (annotations: AnnotationRow[], path = "plan.md") => ({
  annotations,
  orphanMarkers: [],
  path,
  strayIds: [],
  total: annotations.length,
});

const listKey = (path: string) => orpc.annotations.list.queryKey({ input: { path } });

const editSchema = z.object({ id: z.string(), path: z.string(), text: z.string() });
const removeSchema = z.object({
  id: z.string(),
  path: z.string(),
  stripMarkers: z.boolean().optional(),
});

// the item's store as the server holds it: a write moves it and answers the listing it leaves
const mountTab = (annotations: AnnotationRow[], { refuseWrites = false } = {}) => {
  installFakeEditorHost();
  const edits: z.infer<typeof editSchema>[] = [];
  const removes: z.infer<typeof removeSchema>[] = [];
  const server = { listReads: 0, rows: annotations };
  stubRpc({
    "annotations/edit": (input) => {
      const request = editSchema.parse(input);
      edits.push(request);
      if (refuseWrites) {
        throw new Error("the store moved underneath");
      }
      server.rows = server.rows.map((row) =>
        row.id === request.id ? { ...row, root: { ...row.root, text: request.text } } : row,
      );
      return listing(server.rows);
    },
    "annotations/list": () => {
      server.listReads += 1;
      return listing(server.rows);
    },
    "annotations/remove": (input) => {
      const request = removeSchema.parse(input);
      removes.push(request);
      server.rows = server.rows.filter((row) => row.id !== request.id);
      return { ...listing(server.rows), removedIds: [request.id] };
    },
  });
  const queryClient = createWorkspaceQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <AnnotationsTab docPath="plan.md" focus={null} modifier="meta" />
    </QueryClientProvider>,
  );
  return { edits, queryClient, removes, server };
};

const cardOf = (id: string): HTMLElement => {
  const card = document.querySelector<HTMLElement>(`[data-annotation-id="${id}"]`);
  if (card === null) {
    throw new Error(`no card for ${id}`);
  }
  return card;
};

const editNote = async (text: string): Promise<void> => {
  fireEvent.click(await screen.findByRole("button", { name: "Edit the note" }));
  const field = screen.getByLabelText("Note");
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: "Enter" });
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

  it("has the server take a highlight's marks out when no editor holds the item", async () => {
    const { removes } = mountTab([annotation("a1", "anchored", { quote: "words" })]);

    fireEvent.click(await screen.findByRole("button", { name: "Remove highlight" }));

    await waitFor(() => {
      expect(removes).toEqual([{ id: "a1", path: "plan.md", stripMarkers: true }]);
    });
  });

  it("edits a note in place on a click, writing it on Return", async () => {
    const { edits } = mountTab([annotation("a1", "anchored", { quote: "words", text: "old" })]);

    await editNote("new note");

    await waitFor(() => {
      expect(edits).toEqual([{ id: "a1", path: "plan.md", text: "new note" }]);
    });
  });
});

describe("a write from a card", () => {
  it("shows the listing the write answers, reading the list no second time", async () => {
    const { server } = mountTab([annotation("a1", "anchored", { quote: "words", text: "old" })]);

    await editNote("new note");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit the note" }).textContent).toBe("new note");
    });
    expect(server.listReads).toBe(1);
  });

  it("holds a remove's listing as the list's own, without the ids it took out", async () => {
    const { queryClient, server } = mountTab([
      annotation("a1", "anchored", { quote: "first words" }),
      annotation("a2", "anchored", { quote: "second words" }),
    ]);

    await screen.findByText("first words");
    fireEvent.click(within(cardOf("a1")).getByRole("button", { name: "Remove highlight" }));

    await waitFor(() => {
      expect(screen.queryByText("first words")).toBeNull();
    });
    expect(screen.getByText("second words")).toBeTruthy();
    expect(server.listReads).toBe(1);
    expect(queryClient.getQueryData(listKey("plan.md"))).toEqual(
      listing([annotation("a2", "anchored", { quote: "second words" })]),
    );
  });

  it("re-reads only that item's list when the write is refused", async () => {
    // the client logs every refused call
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { queryClient, server } = mountTab(
      [annotation("a1", "anchored", { quote: "words", text: "old" })],
      { refuseWrites: true },
    );
    queryClient.setQueryData(listKey("other.md"), listing([], "other.md"));

    await editNote("new note");

    await waitFor(() => {
      expect(server.listReads).toBe(2);
    });
    expect(queryClient.getQueryState(listKey("other.md"))?.isInvalidated).toBe(false);
    expect(screen.getByRole("button", { name: "Edit the note" }).textContent).toBe("old");
  });
});
