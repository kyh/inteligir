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
import { CommandPalette, type CommandPaletteProps, type PaletteRequest } from "../command-palette";

export interface KnowledgeFakes {
  matches?: (request: KnowledgeMatchesRequest) => KnowledgeMatchesResponse;
  problems?: () => KnowledgeProblemsResponse;
}

const EMPTY_FAMILY = { rows: [], total: 0 };

const noProblems: KnowledgeProblemsResponse = {
  unresolvedLinks: EMPTY_FAMILY,
  missingEmbeds: EMPTY_FAMILY,
  orphans: EMPTY_FAMILY,
  duplicateStems: EMPTY_FAMILY,
};

const requestBodySchema = z.object({ json: z.unknown() });
const matchesRequestSchema = z.object({
  q: z.string(),
  caseSensitive: z.boolean(),
  wholeWord: z.boolean(),
  limit: z.number(),
});

function answer(json: KnowledgeMatchesResponse | KnowledgeProblemsResponse): Response {
  return new Response(JSON.stringify({ json }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// every procedure the palette's pages call; anything else is a 404 the query reports as an error
export function stubKnowledgeFetch(fakes: KnowledgeFakes): void {
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
}

export const defaultRequest: PaletteRequest = { page: "root", nonce: 1 };

export function renderWithQueries(props: CommandPaletteProps) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandPalette {...props} />
    </QueryClientProvider>,
  );
}
