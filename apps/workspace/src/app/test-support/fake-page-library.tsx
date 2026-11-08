// A page library for a screen's suite: the cell's wire over a link the suite answers by procedure,
// recording each call, so a screen runs on the oRPC client and TanStack utils it runs on in the
// tab. The account's threads, their events and the library's titles are answered from what the
// suite hands it, and the account's socket is one the suite speaks for.

import { createORPCClient } from "@orpc/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { ThreadFrame } from "@repo/agent-panel/thread-previews";
import type { V1Client } from "@repo/contract/cloud/v1";
import type {
  threadEventRowSchema,
  threadRowSchema,
} from "@repo/contract/cloud/library/library-wire";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { z } from "zod";

import { createLeaveGuard } from "../cloud/leave-guard";
import { PageLibraryProvider } from "../cloud/library-context";
import type { PageLibrary } from "../cloud/library-context";
import type { ItemsMoved } from "../cloud/use-library-socket";
import { createPageQueryClient } from "../cloud/v1";

export type ThreadRow = z.infer<typeof threadRowSchema>;
export type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

// a call the screen made of the cell: its procedure (`library.history.undo`) and its input
export interface CellCall {
  readonly path: string;
  readonly input: unknown;
}

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
  // what the account's socket says moved
  readonly moved: (moved: ItemsMoved) => void;
  readonly thread: (frame: ThreadFrame) => void;
}

export const fakePageLibrary = ({
  threads = [],
  events = [],
  titles = [],
  answer = () => ({}),
}: {
  threads?: readonly ThreadRow[];
  events?: readonly ThreadEventRow[];
  titles?: readonly { readonly id: string; readonly title: string }[];
  // what the cell answers any other call, by its procedure: every procedure answers an object
  answer?: (call: CellCall) => object | Promise<object>;
}): FakeLibrary => {
  const calls: CellCall[] = [];
  const held = (call: CellCall): object | Promise<object> => {
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
      case "library.listing.titles": {
        return { targets: [...titles] };
      }
      default: {
        return answer(call);
      }
    }
  };
  const client = createORPCClient<V1Client>({
    call: async (path, input) => {
      const call = { input, path: path.join(".") };
      calls.push(call);
      return await held(call);
    },
  });
  const items = listeners<ItemsMoved>();
  const threadFrames = listeners<ThreadFrame>();
  return {
    calls,
    library: {
      account: { email: "person@example.com", name: "" },
      cloud: { fetch: unread, origin: "https://library.test" },
      leave: createLeaveGuard(new EventTarget()),
      left: unread,
      socket: {
        close: nothingToClose,
        connect: nothingToClose,
        onItems: items.add,
        onThread: threadFrames.add,
      },
      wire: { client, orpc: createTanstackQueryUtils(client) },
    },
    moved: items.tell,
    thread: threadFrames.tell,
  };
};

// a screen drawn over the fake, under the page's own QueryClient
export const renderOnLibrary = (ui: ReactNode, library: PageLibrary) =>
  render(
    <QueryClientProvider client={createPageQueryClient()}>
      <PageLibraryProvider library={library}>{ui}</PageLibraryProvider>
    </QueryClientProvider>,
  );
