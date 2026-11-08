// A device for the replica's suites, and the editor's that drive it: the engine over its own
// in-memory SQLite, a clock moved by hand, ids minted in order, staged files in a map, and a block
// merge that keeps both sides' text unless a suite hands its own, all reaching one fake cell
// through the device's own transport.

import type { BlockMerge, NewId, SocketDial, StagedBlobs } from "../replica-ports";
import { openLibraryReplica } from "../library-replica";
import type { LibraryReplica } from "../library-replica";
import { openMemorySql } from "../memory-sql";
import type { MemorySql } from "../memory-sql";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { fakeClock } from "@repo/contract/test-support/fake-clock";
import type { FakeClock } from "@repo/contract/test-support/fake-clock";
import type { FakeCell, FakeDevice } from "@repo/contract/test-support/fake-cell";

// UUIDv7s in order, each device's under a prefix of its own so two devices never mint one id
const idSource = (prefix: number): NewId => {
  let count = 0;
  const head = prefix.toString(16).padStart(4, "0");
  return () => {
    count += 1;
    return `0190${head}-0000-7000-8000-${count.toString(16).padStart(12, "0")}`;
  };
};

/** @internal */
export const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

/** @internal */
export const textOf = (block: LibraryBlock): string =>
  block.children.map((child) => ("text" in child ? child.text : "")).join("");

// a paragraph both sides changed holds theirs, then mine, as a diff3 that kept both would
/** @internal */
export const keepBoth: BlockMerge = async ({ base, mine, theirs }) => {
  const ours = textOf(mine);
  const others = textOf(theirs);
  if (ours === textOf(base) || ours === others) {
    return { block: theirs, overlapped: false };
  }
  if (others === textOf(base)) {
    return { block: mine, overlapped: false };
  }
  return { block: paragraph(theirs.id, `${others} / ${ours}`), overlapped: false };
};

interface MemoryBlobs extends StagedBlobs {
  readonly held: () => readonly string[];
}

const memoryBlobs = (): MemoryBlobs => {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    clear: async () => {
      files.clear();
      await Promise.resolve();
    },
    held: () => [...files.keys()],
    put: async (sha, bytes) => {
      files.set(sha, bytes);
      await Promise.resolve();
    },
    read: async (sha) => await Promise.resolve(files.get(sha) ?? null),
    remove: async (sha) => {
      files.delete(sha);
      await Promise.resolve();
    },
  };
};

/** @internal */
export interface TestDevice {
  readonly replica: LibraryReplica;
  readonly network: FakeDevice;
  readonly clock: FakeClock;
  readonly sql: MemorySql;
  readonly blobs: MemoryBlobs;
  readonly newId: NewId;
}

interface DeviceOptions {
  readonly sql?: MemorySql;
  readonly blobs?: MemoryBlobs;
  readonly network?: FakeDevice;
  readonly dial?: SocketDial;
  readonly clock?: FakeClock;
  readonly idPrefix?: number;
  readonly merge?: BlockMerge;
}

/** @internal */
export const openDevice = async (
  cell: FakeCell,
  name: string,
  options: DeviceOptions = {},
): Promise<TestDevice> => {
  const sql = options.sql ?? (await openMemorySql());
  const blobs = options.blobs ?? memoryBlobs();
  const network = options.network ?? cell.device(name);
  const clock = options.clock ?? fakeClock();
  const newId = idSource(options.idPrefix ?? name.length);
  const opening = await openLibraryReplica({
    blobs,
    clock,
    dial: options.dial ?? null,
    merge: options.merge ?? keepBoth,
    newId,
    sql,
    transport: network.transport,
  });
  if (opening.kind !== "ready") {
    throw new Error(`the replica did not open: SQLite ${opening.sqliteVersion}`);
  }
  return { blobs, clock, network, newId, replica: opening.replica, sql };
};

// the same device after a relaunch: its database and its staged files, a fresh engine
/** @internal */
export const relaunch = async (
  cell: FakeCell,
  name: string,
  device: TestDevice,
): Promise<TestDevice> => {
  await device.replica.close();
  return await openDevice(cell, name, {
    blobs: device.blobs,
    idPrefix: name.length + 100,
    network: device.network,
    sql: device.sql,
  });
};
