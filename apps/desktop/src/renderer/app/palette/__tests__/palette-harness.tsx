// The palette reads its pages through the one oRPC client, so a test answers the wire
// rather than injecting a source: `fetch` is stubbed with the RPC body shape the client
// speaks (`{ json }` in, `{ json }` out), and each render gets a QueryClient of its own.

import type {
  KnowledgeMatchesRequest,
  KnowledgeMatchesResponse,
  KnowledgeProblemsResponse,
} from "@repo/api/local/knowledge/knowledge-schema";
import { RPC_PREFIX } from "@repo/api/local/routes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { z } from "zod";
import { CommandPalette } from "../command-palette";
import type { CommandPaletteProps, PaletteActions, PaletteRequest } from "../command-palette";
import type { NoteSearchSource } from "../note-search";

export interface KnowledgeFakes {
  matches?: (request: KnowledgeMatchesRequest) => KnowledgeMatchesResponse;
  problems?: () => KnowledgeProblemsResponse;
}

const EMPTY_FAMILY = { rows: [], total: 0 };

const noProblems: KnowledgeProblemsResponse = {
  duplicateStems: EMPTY_FAMILY,
  missingEmbeds: EMPTY_FAMILY,
  orphans: EMPTY_FAMILY,
  unresolvedLinks: EMPTY_FAMILY,
};

const requestBodySchema = z.object({ json: z.unknown() });
const matchesRequestSchema = z.object({
  caseSensitive: z.boolean(),
  limit: z.number(),
  q: z.string(),
  wholeWord: z.boolean(),
});

const answer = (json: KnowledgeMatchesResponse | KnowledgeProblemsResponse): Response =>
  Response.json(
    { json },
    {
      headers: { "content-type": "application/json" },
      status: 200,
    },
  );

// every procedure the palette's pages call; anything else is a 404 the query reports as an error
export const stubKnowledgeFetch = (fakes: KnowledgeFakes): void => {
  // oxlint-disable-next-line require-await -- `fetch` is an async port; this fake answers from memory
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost");
    const procedure = url.pathname.slice(`${RPC_PREFIX}/`.length);
    // the oRPC client always sends a string body; anything else is a stub answering the wrong call
    const body = requestBodySchema.parse(JSON.parse(z.string().parse(init?.body ?? "{}")));
    if (procedure === "knowledge/matches" && fakes.matches !== undefined) {
      return answer(fakes.matches(matchesRequestSchema.parse(body.json)));
    }
    if (procedure === "knowledge/problems") {
      return answer(fakes.problems === undefined ? noProblems : fakes.problems());
    }
    return new Response("not stubbed", { status: 404 });
  });
};

export const defaultRequest: PaletteRequest = { nonce: 1, page: "root" };

// oxlint-disable-next-line require-await -- the search source is an async port; this fake answers from memory
export const emptySearchSource: NoteSearchSource = async () => [];

// Every verb the palette can run, each a mock typed by the contract it stands for. A test
// spreads its own over the ones it asserts on.
export const makeActions = () =>
  ({
    exportPdf: null,
    findInNote: null,
    goToHeading: vi.fn<PaletteActions["goToHeading"]>(),
    insertTemplate: null,
    listHeadings: null,
    moveNote: vi.fn<PaletteActions["moveNote"]>(),
    newNote: vi.fn<PaletteActions["newNote"]>(),
    newNoteFromTemplate: vi.fn<PaletteActions["newNoteFromTemplate"]>(),
    openDailyNote: vi.fn<PaletteActions["openDailyNote"]>(),
    openDeletedNotes: vi.fn<PaletteActions["openDeletedNotes"]>(),
    openMatch: vi.fn<PaletteActions["openMatch"]>(),
    openNote: vi.fn<PaletteActions["openNote"]>(),
    openProblemLink: vi.fn<PaletteActions["openProblemLink"]>(),
    openSettings: vi.fn<PaletteActions["openSettings"]>(),
    openThread: vi.fn<PaletteActions["openThread"]>(),
    pin: null,
    replaceAll: vi.fn<PaletteActions["replaceAll"]>(async () => {}),
    syncNow: vi.fn<PaletteActions["syncNow"]>(),
  }) satisfies PaletteActions;

export const renderWithQueries = (props: CommandPaletteProps) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandPalette {...props} />
    </QueryClientProvider>,
  );
};
