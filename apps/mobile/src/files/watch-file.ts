// Where a file draws from, told to a screen as it comes: asked at once, and while it could not be
// had, asked again after each pass of the replica that ends clean, since that is what says the
// cloud answers again. A pass that failed says nothing of the file, and one the screen holds needs
// nothing more. Platform-free: the runtime's suite drives it over the real replica and file cache.

import type { LibraryReplica, ReplicaStatus } from "@repo/library-replica/library-replica";

const cameClean = ({ failure, syncing }: ReplicaStatus): boolean => !syncing && failure === null;

export const watchFile = (args: {
  readonly ask: () => Promise<string | null>;
  readonly replica: Pick<LibraryReplica, "onStatus" | "status">;
  readonly told: (uri: string | null) => void;
}): (() => void) => {
  let watching = true;
  let held = false;
  let clean = cameClean(args.replica.status());

  const ask = async (): Promise<void> => {
    const uri = await args.ask();
    if (watching) {
      held = uri !== null;
      args.told(uri);
    }
  };

  const unwatch = args.replica.onStatus(() => {
    const now = cameClean(args.replica.status());
    if (now && !clean && !held) {
      void ask();
    }
    clean = now;
  });
  void ask();

  return () => {
    watching = false;
    unwatch();
  };
};
