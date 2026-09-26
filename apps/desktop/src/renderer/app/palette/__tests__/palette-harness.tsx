// The palette reads its pages through the one oRPC client, so a test answers the wire rather
// than injecting a source, and each render gets a QueryClient of its own built with the shipped
// defaults, retries included: a cache the bus never sweeps stays stale here as it does there, and
// a refusal lands only as fast as the query's own retry policy lets it.

import type {
  KnowledgeMatchesRequest,
  KnowledgeMatchesResponse,
  KnowledgeProblemsResponse,
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
} from "@repo/api/local/knowledge/knowledge-schema";
import type { ListThreadsResponse } from "@repo/api/local/threads/threads-schema";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";
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
import { stubRpc } from "../../__tests__/rpc-stub";
import { createWorkspaceQueryClient } from "../../workspace-context";

// the vault's bytes, read and written through the guards the real route enforces
export interface FakeVault {
  files: Map<string, string>;
  // every write and remove that landed, in order
  log: string[];
}

export interface PaletteFakes {
  matches?: (
    request: KnowledgeMatchesRequest,
  ) => KnowledgeMatchesResponse | Promise<KnowledgeMatchesResponse>;
  problems?: () => KnowledgeProblemsResponse;
  // unset, the index answers nothing; a throw is the index unreachable
  search?: (
    request: KnowledgeSearchRequest,
    signal: AbortSignal | undefined,
  ) => KnowledgeSearchResponse | Promise<KnowledgeSearchResponse>;
  // unset, the server finds no action
  threads?: (request: ThreadSearchRequest) => ListThreadsResponse;
  // unset, the vault holds nothing
  vault?: FakeVault;
}

const EMPTY_FAMILY = { rows: [], total: 0 };

const noProblems: KnowledgeProblemsResponse = {
  duplicateIds: EMPTY_FAMILY,
  duplicateStems: EMPTY_FAMILY,
  missingEmbeds: EMPTY_FAMILY,
  orphans: EMPTY_FAMILY,
  unresolvedLinks: EMPTY_FAMILY,
};

const matchesRequestSchema = z.object({
  caseSensitive: z.boolean(),
  limit: z.number(),
  q: z.string(),
  wholeWord: z.boolean(),
});
const searchRequestSchema = z.object({ limit: z.number(), q: z.string() });
const threadSearchRequestSchema = z.object({ limit: z.number(), query: z.string() });
type ThreadSearchRequest = z.infer<typeof threadSearchRequestSchema>;
const vaultPathRequestSchema = z.object({ path: z.string() });
const vaultWriteRequestSchema = z.object({
  content: z.string(),
  guard: z.discriminatedUnion("kind", [
    z.object({ hash: z.string(), kind: z.literal("expected") }),
    z.object({ kind: z.literal("absent") }),
    z.object({ kind: z.literal("overwrite") }),
  ]),
  path: z.string(),
});

type RpcAnswers = Parameters<typeof stubRpc>[0];

// a refusal answers as the stub's 500, so a test that provokes one names the logged error itself
const vaultRoutes = (vault: FakeVault): RpcAnswers => ({
  "vault/read": (input) => {
    const { path } = vaultPathRequestSchema.parse(input);
    const content = vault.files.get(path);
    if (content === undefined) {
      throw new Error(`No file at ${path}`);
    }
    return { content, path };
  },
  "vault/remove": (input) => {
    const { path } = vaultPathRequestSchema.parse(input);
    if (!vault.files.delete(path)) {
      throw new Error(`No file at ${path}`);
    }
    vault.log.push(`remove ${path}`);
    return { ok: true };
  },
  "vault/write": async (input) => {
    const { content, guard, path } = vaultWriteRequestSchema.parse(input);
    const current = vault.files.get(path);
    if (guard.kind === "absent" && current !== undefined) {
      throw new Error(`A file already exists at ${path}`);
    }
    if (
      guard.kind === "expected" &&
      (current === undefined || (await contentHashHex(current)) !== guard.hash)
    ) {
      throw new Error(`${path} changed`);
    }
    vault.files.set(path, content);
    vault.log.push(`write ${path}`);
    return { path };
  },
});

// every procedure the palette's pages call; anything else is a 404 the query reports as an error
export const stubPaletteFetch = ({
  matches,
  problems,
  search,
  threads,
  vault = { files: new Map(), log: [] },
}: PaletteFakes): void => {
  stubRpc({
    ...vaultRoutes(vault),
    "knowledge/matches":
      matches === undefined
        ? undefined
        : async (input) => await matches(matchesRequestSchema.parse(input)),
    "knowledge/problems": () => (problems === undefined ? noProblems : problems()),
    "knowledge/search": async (input, signal) => {
      const request = searchRequestSchema.parse(input);
      return search === undefined ? { results: [] } : await search(request, signal);
    },
    "threads/list": (input) => {
      const request = threadSearchRequestSchema.parse(input);
      return threads === undefined ? { nextCursor: null, threads: [] } : threads(request);
    },
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
