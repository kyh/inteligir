// A page library for a screen's suite: the page's own oRPC client and TanStack utils over an
// in-memory link, recording each call, so a screen runs on what it runs on in the tab. A call
// reaches the fake cell (`@repo/contract/test-support/fake-cell`) unless the suite answers it
// itself; the account's threads and their events are answered from what the suite hands it, a
// thread's events streamed after the last one the screen held, then the reply's draft if the suite
// hands one, and nothing asks what moved. A screen drawn on it presses spies for commands, so its suite says which
// press it made and runs none.

import { createORPCClient, DynamicLink } from "@orpc/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import type { FakeCell } from "@repo/contract/test-support/fake-cell";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import type { threadEventRowSchema, threadRowSchema } from "@repo/contract/library/library-wire";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { z } from "zod";

import { PageLibraryProvider } from "../cloud/library-context";
import type { PageLibrary } from "../cloud/library-context";
import { createPageQueryClient } from "../cloud/v1";
import { LibraryCommandsContext } from "../library/library-commands";
import type { LibraryCommands } from "../library/library-commands";
import { createWorkspaceStore } from "../workspace-store";

export type ThreadRow = z.infer<typeof threadRowSchema>;
export type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

// a call the screen made of the cell: its procedure (`library.agent.undo`) and its input
export interface CellCall {
  readonly path: string;
  readonly input: unknown;
}

// the suite's own answer to a call, or undefined to leave it to the fake cell
type Answer = object | undefined;

const unread = (): never => {
  throw new Error("this screen's suite holds no such part of the page library");
};

const nothingToStop = (): void => {
  // the suite's library asks nothing on a beat
};

// one value, since the layout reads it through useSyncExternalStore
const LIVE = { kind: "live" } as const;

const eventsInput = z.object({ threadId: z.string() });

export interface FakeLibrary {
  readonly library: PageLibrary;
  readonly calls: CellCall[];
}

// a thread's events after `lastEventId`, then where they end, then the reply's draft
const streamed = async function* streamed(
  rows: readonly ThreadEventRow[],
  lastEventId: string | undefined,
  draft: string,
) {
  for (const row of rows.slice(rows.findIndex(({ eventId }) => eventId === lastEventId) + 1)) {
    yield await Promise.resolve({ kind: "event", row });
  }
  yield { kind: "caughtUp" };
  if (draft !== "") {
    yield { kind: "draft", text: draft };
  }
};

export const fakePageLibrary = ({
  cell = createFakeCell(),
  threads = [],
  events = [],
  draft = "",
  answer = () => {},
}: {
  cell?: FakeCell;
  threads?: readonly ThreadRow[];
  events?: readonly ThreadEventRow[];
  draft?: string;
  answer?: (call: CellCall) => Answer | Promise<Answer>;
} = {}): FakeLibrary => {
  const calls: CellCall[] = [];
  const answered = (call: CellCall, lastEventId: string | undefined): Answer | Promise<Answer> => {
    switch (call.path) {
      case "library.agent.list": {
        return { cursor: null, threads: [...threads] };
      }
      case "library.agent.events": {
        const { threadId } = eventsInput.parse(call.input);
        const rows = events.filter((row) => row.threadId === threadId);
        return streamed(rows, lastEventId, draft);
      }
      default: {
        return answer(call);
      }
    }
  };
  const cellLink = cell.device("page").link;
  const client = createORPCClient<V1Client>(
    new DynamicLink(async ({ lastEventId }, path, input) => {
      const call = { input, path: path.join(".") };
      calls.push(call);
      const held = await answered(call, lastEventId);
      return held === undefined ? cellLink : { call: async () => await Promise.resolve(held) };
    }),
  );
  return {
    calls,
    library: {
      account: { email: "person@example.com", name: "" },
      changes: { start: () => nothingToStop },
      cloud: { fetch: unread, onSessionEnd: unread, origin: "https://library.test" },
      left: unread,
      session: { get: () => LIVE, subscribe: () => () => {} },
      wire: { client, orpc: createTanstackQueryUtils(client) },
      workspace: createWorkspaceStore(),
    },
  };
};

export const spyCommands = () =>
  ({
    askAgent: vi.fn<LibraryCommands["askAgent"]>(),
    askSaveLink: vi.fn<LibraryCommands["askSaveLink"]>(),
    closeItem: vi.fn<LibraryCommands["closeItem"]>(),
    deleteFolder: vi.fn<LibraryCommands["deleteFolder"]>(),
    emptyDeleted: vi.fn<LibraryCommands["emptyDeleted"]>(),
    move: vi.fn<LibraryCommands["move"]>(),
    newFolder: vi.fn<LibraryCommands["newFolder"]>(),
    newNote: vi.fn<LibraryCommands["newNote"]>(),
    openItem: vi.fn<LibraryCommands["openItem"]>(),
    openPalette: vi.fn<LibraryCommands["openPalette"]>(),
    openSettings: vi.fn<LibraryCommands["openSettings"]>(),
    pin: vi.fn<LibraryCommands["pin"]>(),
    purge: vi.fn<LibraryCommands["purge"]>(),
    refresh: vi.fn<LibraryCommands["refresh"]>(),
    remove: vi.fn<LibraryCommands["remove"]>(),
    renameFolder: vi.fn<LibraryCommands["renameFolder"]>(),
    restore: vi.fn<LibraryCommands["restore"]>(),
    save: vi.fn<LibraryCommands["save"]>(),
    saveLink: vi.fn<LibraryCommands["saveLink"]>(),
    showKind: vi.fn<LibraryCommands["showKind"]>(),
    showScope: vi.fn<LibraryCommands["showScope"]>(),
    startTidy: vi.fn<LibraryCommands["startTidy"]>(),
    tag: vi.fn<LibraryCommands["tag"]>(),
  }) satisfies LibraryCommands;

// the page's providers over the fake, under one page QueryClient of its own
const onLibrary = (library: PageLibrary, commands: LibraryCommands = spyCommands()) => {
  const queryClient = createPageQueryClient();
  const OnLibrary = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <PageLibraryProvider library={library}>
        <LibraryCommandsContext value={commands}>{children}</LibraryCommandsContext>
      </PageLibraryProvider>
    </QueryClientProvider>
  );
  return OnLibrary;
};

export const renderOnLibrary = (ui: ReactNode, library: PageLibrary, commands?: LibraryCommands) =>
  render(ui, { wrapper: onLibrary(library, commands) });

export const renderHookOnLibrary = <T,>(hook: () => T, library: PageLibrary) =>
  renderHook(hook, { wrapper: onLibrary(library) });
