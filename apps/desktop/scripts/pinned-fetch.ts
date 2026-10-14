// A file the pack downloads rather than installs, pinned by sha-256: the git and the node the .app
// carries (fetch-git.ts, fetch-node.ts), each cached under its own folder of .cache.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { run } from "./run.ts";

export interface PinnedFile {
  readonly name: string;
  readonly sha256: string;
  readonly url: string;
}

interface FetchPinnedOptions {
  readonly cacheDir: string;
  readonly log: (line: string) => void;
}

const sha256Of = async (file: string): Promise<string> => {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
};

// cached by name and verified on every run, so a truncated or altered copy is fetched again
export const fetchPinned = async (
  { name, sha256, url }: PinnedFile,
  { cacheDir, log }: FetchPinnedOptions,
): Promise<string> => {
  const file = path.join(cacheDir, name);
  if (existsSync(file) && (await sha256Of(file)) === sha256) {
    return file;
  }
  log(`downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`${url} answered ${response.status}`);
  }
  const partial = `${file}.partial`;
  await mkdir(cacheDir, { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  const actual = await sha256Of(partial);
  if (actual !== sha256) {
    await rm(partial, { force: true });
    throw new Error(`${url} hashed ${actual}, not the pinned ${sha256}`);
  }
  await rename(partial, file);
  return file;
};

// `members` narrows the extraction to those paths inside the tarball; none extracts it whole
export const untar = (tarball: string, into: string, members: readonly string[] = []): void => {
  run("tar", ["-xzf", tarball, "-C", into, ...members]);
};
