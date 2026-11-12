// A page library for a screen's suite: the page's own oRPC client and TanStack utils over an
// in-memory link, recording each call, so a screen runs on what it runs on in the tab. A call
// reaches the fake cell (`@repo/contract/test-support/fake-cell`) unless the suite answers it
// itself; the account's threads and their events are answered from what the suite hands it, and
// the account's socket is one the suite speaks for.

import { createORPCClient, DynamicLink } from "@orpc/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import type { FakeCell } from "@repo/contract/test-support/fake-cell";
import type { V1Client } from "@repo/contract/v1";
import type { threadEventRowSchema, threadRowSchema } from "@repo/contract/library/library-wire";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { z } from "zod";

import { createLeaveGuard } from "../cloud/leave-guard";
import { PageLibraryProvider } from "../cloud/library-context";
import type { PageLibrary } from "../cloud/library-context";
import type { ItemsMoved, ThreadPreview } from "../cloud/use-library-socket";
import { createPageQueryClient } from "../cloud/v1";

export type ThreadRow = z.infer<typeof threadRowSchema>;
export type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

// a call the screen made of the cell: its procedure (`library.history.undo`) and its input
export interface CellCall {
  readonly path: string;
  readonly input: unknown;
}

// the suite's own answer to a call, or undefined to leave it to the fake cell
type Answer = object | undefined;

const unread = (): never => {
  throw new Error("this screen's suite holds no such part of the page library");
};

const nothingToClose = (): void => {
  // the suite's socket dials nothing
};

const eventsInput = z.object({ after: z.number().optional(), threadId: z.string() });

const listeners = <T,>() => {
  const held = new Set<(value: T) => void>();
  return {
    add: (listener: (value: T) => void) => {
      held.add(listener);
      return () => {
        held.delete(listener);
      };
    },
    tell: (value: T) => {
      for (const listener of held) {
        listener(value);
      }
    },
  };
};

export interface FakeLibrary {
  readonly library: PageLibrary;
  readonly calls: CellCall[];
  // what the account's socket says moved, and of the reply being written
  readonly moved: (moved: ItemsMoved) => void;
  readonly preview: (preview: ThreadPreview) => void;
}

export const fakePageLibrary = ({
  cell = createFakeCell(),
  threads = [],
  events = [],
  answer = () => {},
}: {
  cell?: FakeCell;
  threads?: readonly ThreadRow[];
  events?: readonly ThreadEventRow[];
  answer?: (call: CellCall) => Answer | Promise<Answer>;
} = {}): FakeLibrary => {
  const calls: CellCall[] = [];
  const answered = (call: CellCall): Answer | Promise<Answer> => {
    switch (call.path) {
      case "library.agent.list": {
        return { cursor: null, threads: [...threads] };
      }
      case "library.agent.events": {
        const { after = -1, threadId } = eventsInput.parse(call.input);
        return {
          events: events.filter((row) => row.threadId === threadId && row.idx > after),
          more: false,
        };
      }
      default: {
        return answer(call);
      }
    }
  };
  const cellLink = cell.device("page").link;
  const client = createORPCClient<V1Client>(
    new DynamicLink(async (_options, path, input) => {
      const call = { input, path: path.join(".") };
      calls.push(call);
      const held = await answered(call);
      return held === undefined ? cellLink : { call: async () => await Promise.resolve(held) };
    }),
  );
  const items = listeners<ItemsMoved>();
  const previews = listeners<ThreadPreview>();
  return {
    calls,
    library: {
      account: { email: "person@example.com", name: "" },
      cloud: { fetch: unread, onSessionEnd: unread, origin: "https://library.test" },
      leave: createLeaveGuard(new EventTarget()),
      left: unread,
      socket: {
        close: nothingToClose,
        connect: nothingToClose,
        offline: nothingToClose,
        onItems: items.add,
        onPreview: previews.add,
        online: nothingToClose,
      },
      wire: { client, orpc: createTanstackQueryUtils(client) },
    },
    moved: items.tell,
    preview: previews.tell,
  };
};

// a screen drawn over the fake, under the page's own QueryClient
export const renderOnLibrary = (ui: ReactNode, library: PageLibrary) =>
  render(
    <QueryClientProvider client={createPageQueryClient()}>
      <PageLibraryProvider library={library}>{ui}</PageLibraryProvider>
    </QueryClientProvider>,
  );
