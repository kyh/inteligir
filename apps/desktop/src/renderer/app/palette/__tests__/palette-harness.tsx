// The palette reads its pages through the one oRPC client, so a test answers the wire
// rather than injecting a source: `fetch` is stubbed with the RPC body shape the client
// speaks (`{ json }` in, `{ json }` out), and each render gets a QueryClient of its own, built
// with the shipped defaults so a cache the bus never sweeps stays stale here as it does there.

import type {
  KnowledgeMatchesRequest,
  KnowledgeMatchesResponse,
  KnowledgeProblemsResponse,
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
} from "@repo/api/local/knowledge/knowledge-schema";
import { RPC_PREFIX } from "@repo/api/local/routes";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { z } from "zod";
import { CommandPalette } from "../command-palette";
import type {
  CommandPaletteProps,
  PaletteActions,
  PaletteNote,
  PaletteRequest,
} from "../command-palette";
import { createWorkspaceQueryClient } from "../../workspace-context";

export interface KnowledgeFakes {
  matches?: (
    request: KnowledgeMatchesRequest,
  ) => KnowledgeMatchesResponse | Promise<KnowledgeMatchesResponse>;
  problems?: () => KnowledgeProblemsResponse;
  // unset, the index answers nothing; a throw is the index unreachable
  search?: (
    request: KnowledgeSearchRequest,
    signal: AbortSignal | undefined,
  ) => KnowledgeSearchResponse | Promise<KnowledgeSearchResponse>;
}

const EMPTY_FAMILY = { rows: [], total: 0 };

const noProblems: KnowledgeProblemsResponse = {
  duplicateIds: EMPTY_FAMILY,
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
const searchRequestSchema = z.object({ limit: z.number(), q: z.string() });

const answer = (
  json: KnowledgeMatchesResponse | KnowledgeProblemsResponse | KnowledgeSearchResponse,
): Response =>
  Response.json(
    { json },
    {
      headers: { "content-type": "application/json" },
      status: 200,
    },
  );

// every procedure the palette's pages call; anything else is a 404 the query reports as an error
export const stubKnowledgeFetch = (fakes: KnowledgeFakes): void => {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost");
    const procedure = url.pathname.slice(`${RPC_PREFIX}/`.length);
    // the oRPC client always sends a string body; anything else is a stub answering the wrong call
    const body = requestBodySchema.parse(JSON.parse(z.string().parse(init?.body ?? "{}")));
    if (procedure === "knowledge/matches" && fakes.matches !== undefined) {
      return answer(await fakes.matches(matchesRequestSchema.parse(body.json)));
    }
    if (procedure === "knowledge/problems") {
      return answer(fakes.problems === undefined ? noProblems : fakes.problems());
    }
    if (procedure === "knowledge/search") {
      const request = searchRequestSchema.parse(body.json);
      return answer(
        fakes.search === undefined
          ? { results: [] }
          : await fakes.search(request, init?.signal ?? undefined),
      );
    }
    return new Response("not stubbed", { status: 404 });
  });
};

export const defaultRequest: PaletteRequest = { nonce: 1, page: "root" };

// Every verb the palette can run, each a mock typed by the contract it stands for, with no note
// open. A test spreads its own over the ones it asserts on.
export const makeActions = () =>
  ({
    goToHeading: vi.fn<PaletteActions["goToHeading"]>(),
    moveNote: vi.fn<PaletteActions["moveNote"]>(),
    newNote: vi.fn<PaletteActions["newNote"]>(),
    newNoteFromTemplate: vi.fn<PaletteActions["newNoteFromTemplate"]>(),
    note: null,
    openDailyNote: vi.fn<PaletteActions["openDailyNote"]>(),
    openDeletedNotes: vi.fn<PaletteActions["openDeletedNotes"]>(),
    openMatch: vi.fn<PaletteActions["openMatch"]>(),
    openNote: vi.fn<PaletteActions["openNote"]>(),
    openProblemLink: vi.fn<PaletteActions["openProblemLink"]>(),
    openSettings: vi.fn<PaletteActions["openSettings"]>(),
    openThread: vi.fn<PaletteActions["openThread"]>(),
    replaceAll: vi.fn<PaletteActions["replaceAll"]>(async () => {}),
    syncNow: vi.fn<PaletteActions["syncNow"]>(),
  }) satisfies PaletteActions;

// an open, unpinned note with no headings, every verb a mock
export const makeNote = (path = "Welcome.md") =>
  ({
    exportPdf: vi.fn<PaletteNote["exportPdf"]>(),
    findInNote: vi.fn<PaletteNote["findInNote"]>(),
    insertTemplate: vi.fn<PaletteNote["insertTemplate"]>(),
    listHeadings: vi.fn<PaletteNote["listHeadings"]>(() => []),
    path,
    pinned: false,
    togglePin: vi.fn<PaletteNote["togglePin"]>(),
  }) satisfies PaletteNote;

// keyed like the workspace keys it, so a rerender with a new nonce is a fresh open
const palette = (props: CommandPaletteProps) => (
  <CommandPalette key={props.request.nonce} {...props} />
);

export const renderWithQueries = (props: CommandPaletteProps) => {
  const queryClient = createWorkspaceQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = render(palette(props), { wrapper });
  return {
    queryClient,
    rerender: (next: CommandPaletteProps): void => {
      view.rerender(palette(next));
    },
  };
};
