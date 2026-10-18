import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gitAt } from "./git-run";
import { COMMIT_BUDGET_BYTES, planStaging, readStagingEntries } from "./git-stage";
import {
  commitCount,
  git,
  gitDirPath,
  lastMessage,
  makeBareRemote,
  makeEngine,
  syncState,
  tipOf,
  trackedFiles,
} from "./test-support/git-fixtures";

const MiB = 1024 * 1024;

// distinct bytes per file, so each is its own blob; zeros past the first byte pack fast
const fileOf = (bytes: number, mark: number): Buffer => {
  const buffer = Buffer.alloc(bytes);
  buffer[0] = mark;
  return buffer;
};

// what the object store holds, loose and packed, in KiB
const objectStoreKiB = async (root: string): Promise<number> => {
  const { stdout } = await git.run(root, ["count-objects", "-v"]);
  const field = (name: string): number => {
    const match = new RegExp(`^${name}: (?<kib>\\d+)$`, "mu").exec(stdout);
    return Number(match?.groups?.kib ?? "0");
  };
  return field("size") + field("size-pack");
};

const commitsTouching = async (root: string, filePath: string): Promise<string[]> => {
  const { stdout } = await git.run(root, ["log", "--format=%s", "--", filePath]);
  return stdout.split("\n").filter((line) => line.length > 0);
};

describe("planStaging", () => {
  it("stages within the budget, defers the rest, and never stages a file over the cap", () => {
    const plan = planStaging(
      [
        { bytes: 9 * MiB, indexed: false, path: "a.bin" },
        { bytes: null, indexed: true, path: "gone.md" },
        { bytes: 12 * MiB, indexed: false, path: "big.bin" },
        { bytes: 11 * MiB, indexed: true, path: "grown.bin" },
        { bytes: 9 * MiB, indexed: false, path: "b.bin" },
        { bytes: 9 * MiB, indexed: false, path: "c.bin" },
        { bytes: 9 * MiB, indexed: false, path: "d.bin" },
        { bytes: 10, indexed: false, path: "note.md" },
        { bytes: 10, indexed: false, path: "claimed.md" },
      ],
      { leaveOut: new Set(["claimed.md"]) },
    );
    expect(plan.stage).toEqual(["a.bin", "gone.md", "b.bin", "c.bin", "note.md"]);
    expect(plan.rest).toEqual(["d.bin"]);
    expect(plan.tooLarge).toEqual([{ bytes: 12 * MiB, path: "big.bin" }]);
    expect(plan.untrack).toEqual([{ bytes: 11 * MiB, path: "grown.bin" }]);
  });

  it("leaves out what is under a left-out folder, as a pathspec of it would match", () => {
    const plan = planStaging(
      [
        { bytes: null, indexed: true, path: "Removed/a.md" },
        { bytes: 3, indexed: false, path: "Removed/deeper/b.png" },
        { bytes: 3, indexed: false, path: "Removed copy/c.md" },
      ],
      { leaveOut: new Set(["Removed"]) },
    );
    expect(plan.stage).toEqual(["Removed copy/c.md"]);
  });

  it("always takes a commit's first file, whatever the budget", () => {
    const plan = planStaging([{ bytes: 5, indexed: false, path: "a" }], { budgetBytes: 1 });
    expect(plan.stage).toEqual(["a"]);
  });
});

describe("the size gate on a real repo", { timeout: 60_000 }, () => {
  it("never stages a 12 MB file, so the object store does not grow by it, and the status names it", async () => {
    const { engine, root } = await makeEngine({ remoteUrl: null });
    const before = await objectStoreKiB(root);
    await writeFile(path.join(root, "huge.bin"), fileOf(12 * MiB, 1));
    await writeFile(path.join(root, "note.md"), "# small\n");

    expect(await engine.commitNow()).toEqual({ files: 1 });
    expect(await trackedFiles(root)).toEqual(["note.md"]);
    expect(await objectStoreKiB(root)).toBeLessThan(before + 256);

    const status = await engine.status();
    expect(status.tooLarge).toEqual({
      count: 1,
      files: [{ bytes: 12 * MiB, path: "huge.bin" }],
    });
    // what never enters history leaves nothing to commit
    expect(await engine.commitNow()).toBeNull();
    expect(await lastMessage(root)).toBe("vault: update note.md");
  });

  it("splits five 9 MB files into two commits of at most the budget", async () => {
    const { engine, root } = await makeEngine({ remoteUrl: null });
    const before = await commitCount(root);
    for (const index of [1, 2, 3, 4, 5]) {
      await writeFile(path.join(root, `scan-${String(index)}.pdf`), fileOf(9 * MiB, index));
    }

    expect(await engine.commitNow()).toEqual({ files: 5 });
    expect(await commitCount(root)).toBe(before + 2);
    const { stdout } = await git.run(root, ["log", "-2", "--format=%H"]);
    for (const sha of stdout.split("\n").filter((line) => line.length > 0)) {
      const listed = await git.run(root, ["diff-tree", "--no-commit-id", "-r", "-z", sha]);
      const added = listed.stdout.split("\0").filter((token) => token.endsWith(".pdf"));
      expect(added.length * 9 * MiB).toBeLessThanOrEqual(COMMIT_BUDGET_BYTES);
    }
    expect(await trackedFiles(root)).toHaveLength(5);
  });

  it("names a literal `[x].md` alone, never the `x.md` a glob would match", async () => {
    const { engine, root } = await makeEngine({ remoteUrl: null });
    await writeFile(path.join(root, "[x].md"), "# bracketed\n");
    await writeFile(path.join(root, "x.md"), "# plain\n");

    expect(await engine.commitNow(["[x].md"])).toEqual({ files: 1 });
    expect(await trackedFiles(root)).toEqual(["[x].md"]);
  });

  it("leaves a live turn's claims out of the checkpoint, however many paths it stages", async () => {
    const { engine, root } = await makeEngine({ remoteUrl: null });
    await mkdir(path.join(root, "many"), { recursive: true });
    for (let index = 0; index < 250; index += 1) {
      await writeFile(path.join(root, "many", `n-${String(index)}.md`), `# ${String(index)}\n`);
    }
    await writeFile(path.join(root, "claimed.md"), "# the turn's\n");
    const hold = engine.holdCommits();
    hold.claim(["claimed.md"]);

    expect(await engine.checkpointUnclaimed()).toEqual({ files: 250 });
    const tracked = await trackedFiles(root);
    expect(tracked).toHaveLength(250);
    expect(tracked).not.toContain("claimed.md");
    hold.release();

    // a scoped commit naming more paths than an argv pathspec takes reads the tree whole
    const named = Array.from({ length: 250 }, (_, index) => `many/n-${String(index)}.md`);
    for (const file of named) {
      await writeFile(path.join(root, file), "# edited\n");
    }
    expect(await engine.commitNow(named)).toEqual({ files: 250 });
    const entries = await readStagingEntries(gitAt(git, root), root);
    expect(entries.map((entry) => entry.path)).toEqual(["claimed.md"]);
  });

  it("takes a file that grew past the cap out of history, as a deletion another clone takes", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ device: "Mac A", remoteUrl: remote });
    const b = await makeEngine({ device: "Mac B", remoteUrl: remote });
    await writeFile(path.join(a.root, "video.mp4"), fileOf(9 * MiB, 7));
    await a.engine.commitNow();
    expect(await syncState(a.engine)).toBe("clean");
    expect(await syncState(b.engine)).toBe("clean");
    expect(existsSync(path.join(b.root, "video.mp4"))).toBe(true);

    await writeFile(path.join(a.root, "video.mp4"), fileOf(12 * MiB, 7));
    const passed = await a.engine.syncNow();
    expect(passed.lastError).toBeNull();
    expect(passed.state).toBe("clean");
    expect(await trackedFiles(a.root)).not.toContain("video.mp4");
    const kept = await stat(path.join(a.root, "video.mp4"));
    expect(kept.size).toBe(12 * MiB);
    const status = await a.engine.status();
    expect(status.tooLarge.files).toEqual([{ bytes: 12 * MiB, path: "video.mp4" }]);
    // the version history keeps, then the commit that took it out
    const touching = await commitsTouching(a.root, "video.mp4");
    expect(touching).toEqual([
      "video.mp4 is over 10 MB, so it stays on this Mac",
      "vault: update video.mp4",
    ]);

    expect(await syncState(b.engine)).toBe("clean");
    expect(existsSync(path.join(b.root, "video.mp4"))).toBe(false);
    const status2 = await b.engine.status();
    expect(status2.tooLarge.count).toBe(0);
  });

  // the other device's tip still holds the file's last version, so a rebase onto it would check
  // that version out over the grown file this Mac keeps: git refuses it before it starts, and the
  // pass merges, keeping this side's deletion and never writing the path
  it("merges past another device's change made while this Mac took a grown file out of history", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ device: "Mac A", remoteUrl: remote });
    const b = await makeEngine({ device: "Mac B", remoteUrl: remote });
    await writeFile(path.join(a.root, "video.mp4"), fileOf(9 * MiB, 7));
    await a.engine.commitNow();
    expect(await syncState(a.engine)).toBe("clean");
    expect(await syncState(b.engine)).toBe("clean");

    await writeFile(path.join(b.root, "other.md"), "# From B\n");
    await b.engine.commitNow();
    expect(await syncState(b.engine)).toBe("clean");

    await writeFile(path.join(a.root, "video.mp4"), fileOf(12 * MiB, 7));
    const passed = await a.engine.syncNow();
    expect(passed.lastError).toBeNull();
    expect(passed.state).toBe("clean");
    expect(existsSync(await gitDirPath(a.root, "rebase-merge"))).toBe(false);
    expect(existsSync(await gitDirPath(a.root, "rebase-apply"))).toBe(false);

    const head = await tipOf(remote, "main");
    const { stdout: parents } = await git.run(remote, ["rev-list", "--parents", "-n", "1", head]);
    expect(parents.trim().split(" ")).toHaveLength(3);
    const { stdout: listed } = await git.run(remote, ["ls-tree", "-r", "--name-only", head]);
    const onRemote = listed.split("\n");
    expect(onRemote).toContain("other.md");
    expect(onRemote).not.toContain("video.mp4");
    const kept = await stat(path.join(a.root, "video.mp4"));
    expect(kept.size).toBe(12 * MiB);
    expect(existsSync(path.join(a.root, "other.md"))).toBe(true);
  });
});
