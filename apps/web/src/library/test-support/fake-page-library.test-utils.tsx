import { createORPCClient, DynamicLink } from "@orpc/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createFakeCell } from "@repo/contract/test-support/fake-cell.test-utils";
import type { FakeCell } from "@repo/contract/test-support/fake-cell.test-utils";
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

export interface CellCall {
  readonly path: string;
  readonly input: unknown;
}

type Answer = object | undefined;

const unread = (): never => {
  throw new Error("this screen's suite holds no such part of the page library");
};

const nothingToStop = () => {};

const LIVE = { kind: "live" } as const;

const eventsInput = z.object({ threadId: z.string() });

interface FakeLibrary {
  readonly library: PageLibrary;
  readonly calls: CellCall[];
}

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
} = {}) => {
  const calls: CellCall[] = [];

  const answered: (call: CellCall, lastEventId: string | undefined) => Answer | Promise<Answer> = (
    call: CellCall,
    lastEventId: string | undefined,
  ) => {
    switch (call.path) {
      case "library.agent.list": {
        return { cursor: null, threads: [...threads] } satisfies Answer | Promise<Answer>;
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
      wire: { client, orpc: createTanstackQueryUtils(client), outliving: client },
      workspace: createWorkspaceStore(),
    },
  } satisfies FakeLibrary;
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
    newList: vi.fn<LibraryCommands["newList"]>(),
    newNote: vi.fn<LibraryCommands["newNote"]>(),
    newNoteIn: vi.fn<LibraryCommands["newNoteIn"]>(),
    openItem: vi.fn<LibraryCommands["openItem"]>(),
    openPalette: vi.fn<LibraryCommands["openPalette"]>(),
    openSettings: vi.fn<LibraryCommands["openSettings"]>(),
    pin: vi.fn<LibraryCommands["pin"]>(),
    purge: vi.fn<LibraryCommands["purge"]>(),
    refresh: vi.fn<LibraryCommands["refresh"]>(),
    remove: vi.fn<LibraryCommands["remove"]>(),
    removeView: vi.fn<LibraryCommands["removeView"]>(),
    renameFolder: vi.fn<LibraryCommands["renameFolder"]>(),
    restore: vi.fn<LibraryCommands["restore"]>(),
    save: vi.fn<LibraryCommands["save"]>(),
    saveLink: vi.fn<LibraryCommands["saveLink"]>(),
    saveView: vi.fn<LibraryCommands["saveView"]>(),
    showKind: vi.fn<LibraryCommands["showKind"]>(),
    showScope: vi.fn<LibraryCommands["showScope"]>(),
    showView: vi.fn<LibraryCommands["showView"]>(),
    showWords: vi.fn<LibraryCommands["showWords"]>(),
    startTidy: vi.fn<LibraryCommands["startTidy"]>(),
    tag: vi.fn<LibraryCommands["tag"]>(),
  }) satisfies LibraryCommands;

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
