// A page library for a screen's suite: a replica that answers only what the panels read (the
// account's threads and their stored events, no row), and the cell's wire over a link the suite
// answers by procedure, recording each call, so a screen runs on the oRPC client and TanStack
// utils it runs on in the tab.

import { createORPCClient } from "@orpc/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { V1Client } from "@repo/contract/cloud/v1";
import type {
  threadEventRowSchema,
  threadRowSchema,
} from "@repo/contract/cloud/library/library-wire";
import type { LibraryReplica, ReplicaStatus } from "@repo/library-replica/library-replica";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { z } from "zod";

import { createLeaveGuard } from "../cloud/leave-guard";
import { PageLibraryProvider } from "../cloud/library-context";
import type { PageLibrary } from "../cloud/page-library";
import { createPageQueryClient } from "../cloud/v1";

export type ThreadRow = z.infer<typeof threadRowSchema>;
export type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

// a call the screen made of the cell: its procedure (`library.history.undo`) and its input
export interface CellCall {
  readonly path: string;
  readonly input: unknown;
}

const unread = (): never => {
  throw new Error("this screen's suite holds no such read of the replica");
};

const nothingToStop = (): void => {
  // a fake's feed that never moves has nothing to unsubscribe
};

const follows = (): (() => void) => nothingToStop;

const STATUS: ReplicaStatus = {
  bodies: { fetched: 0, total: 0 },
  cursor: 0,
  failure: null,
  head: 0,
  parked: [],
  syncing: false,
  unsent: 0,
};

export interface FakeLibrary {
  readonly library: PageLibrary;
  readonly calls: CellCall[];
}

export const fakePageLibrary = ({
  threads = [],
  events = [],
  answer,
}: {
  threads?: readonly ThreadRow[];
  events?: readonly ThreadEventRow[];
  // what the cell answers a call, by its procedure: every procedure answers an object
  answer: (call: CellCall) => object;
}): FakeLibrary => {
  const calls: CellCall[] = [];
  const client = createORPCClient<V1Client>({
    call: async (path, input) => {
      const call = { input, path: path.join(".") };
      calls.push(call);
      return await Promise.resolve(answer(call));
    },
  });
  const replica: LibraryReplica = {
    annotations: unread,
    close: unread,
    createFile: unread,
    createNote: unread,
    deleteItems: unread,
    discard: unread,
    focus: unread,
    folders: unread,
    item: unread,
    listing: unread,
    onChange: follows,
    onStatus: follows,
    onThreadFrame: follows,
    restoreItems: unread,
    resume: unread,
    retry: unread,
    row: () => null,
    saveLink: unread,
    savePage: unread,
    scopes: unread,
    search: unread,
    start: unread,
    status: () => STATUS,
    suspend: unread,
    sync: unread,
    threadEvents: async (threadId) =>
      await Promise.resolve(events.filter((row) => row.threadId === threadId)),
    threads: async () => await Promise.resolve([...threads]),
    wipe: unread,
    write: unread,
    writeFolders: unread,
  };
  return {
    calls,
    library: {
      account: { email: "person@example.com", name: "" },
      leave: createLeaveGuard(new EventTarget()),
      replica,
      wire: { client, orpc: createTanstackQueryUtils(client) },
    },
  };
};

// a screen drawn over the fake, under the page's own QueryClient
export const renderOnLibrary = (ui: ReactNode, library: PageLibrary) =>
  render(
    <QueryClientProvider client={createPageQueryClient()}>
      <PageLibraryProvider library={library}>{ui}</PageLibraryProvider>
    </QueryClientProvider>,
  );
