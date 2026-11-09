// A block's hash: what a write names as the base it was computed from, and the key a change set's
// block versions are kept under. The content hash (`./content-hash.ts`) of the block's canonical
// JSON.

import { canonicalJson } from "./canonical-json";
import { contentHash } from "./content-hash";
import type { LibraryBlock } from "./library-nodes";

export const BLOCK_HASH_RE = /^[0-9a-f]{32}$/u;

export const blockHash = (block: LibraryBlock): string => contentHash(canonicalJson(block));
