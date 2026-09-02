import { DurableObject } from "cloudflare:workers";

// durable-git publishes TypeScript source with no .d.ts, which tsc rejects under this repo's
// stricter flags, so the worker tsconfig's `paths` maps the package here; the bundler ignores
// `paths` and resolves the real source. Transcribed from durable-git@0.0.8; re-check on a bump.

export interface Env {
  REPO: DurableObjectNamespace<RepoCell>;
  REGISTRY: DurableObjectNamespace<Registry>;
  PACK_CACHE?: R2Bucket;
  GIT_TOKEN?: string;
  GIT_TOKENS?: string;
  MAX_PUSH_MB?: string;
  INGEST_CACHE_MB?: string;
  SHA1DC?: string;
  SITE_NAME?: string;
  SITE_DESC?: string;
  SITE_OWNER?: string;
}

export type AuthOp = "read" | "write" | "admin";

export interface AuthContext<E extends Env = Env> {
  repo: string;
  op: AuthOp;
  private: boolean;
  credentials: { user: string; pass: string } | null;
  /** headers and URL only — the body is consumed downstream */
  request: Request;
  env: E;
}

export interface RefUpdate {
  ref: string;
  old: string;
  new: string;
}

export interface PushEvent {
  repo: string;
  updates: RefUpdate[];
  /** unix millis */
  commitTime: number;
}

export interface DurableGitOptions<E extends Env = Env> {
  authorize?: (ctx: AuthContext<E>) => boolean | Response | Promise<boolean | Response>;
  onPush?: (event: PushEvent, env: E) => void | Promise<void>;
  ui?: boolean;
  cors?: string;
  namespaces?: boolean;
}

export interface DurableGitHandler<E extends Env = Env> {
  fetch(req: Request, env: E, ctx: ExecutionContext): Promise<Response>;
}

export function createDurableGit<E extends Env = Env>(
  options?: DurableGitOptions<E>,
): DurableGitHandler<E>;

export function secretsEqual(a: string, b: string): Promise<boolean>;

export interface Person {
  name: string;
  email: string;
  /** unix seconds */
  time: number;
  tz: string;
}

export interface RefsResult {
  head: string | null;
  refs: { name: string; target: string; peeled?: string }[];
}

export interface CommitJson {
  oid: string;
  tree: string;
  parents: string[];
  author: Person;
  committer: Person;
  subject: string;
  message: string;
}

export interface LogResult {
  commits: CommitJson[];
  more: boolean;
}

export interface TreeEntryJson {
  name: string;
  mode: string;
  type: "tree" | "blob" | "commit";
  oid: string;
  size?: number;
}

export interface TreeResult {
  oid: string;
  entries: TreeEntryJson[];
}

export interface BlobResult {
  oid: string;
  mode: string;
  data: Uint8Array;
}

export type RepoInfo = {
  name: string;
  desc: string;
  owner: string;
  section: string;
  /** 1 = requires auth for all access */
  priv: number;
  /** unix millis */
  idle: number;
  ver: number;
};

export type RepoConfig = {
  desc?: string;
  owner?: string;
  section?: string;
  priv?: boolean;
};

export declare class RepoCell extends DurableObject<Env> {
  fetch(req: Request): Promise<Response>;
  listRefs(): Promise<RefsResult>;
  readCommit(id?: string): Promise<CommitJson | null>;
  listLog(ref?: string, opts?: { path?: string; ofs?: number; n?: number }): Promise<LogResult>;
  listTree(ref?: string, path?: string): Promise<TreeResult | null>;
  readBlob(ref: string | undefined, path: string): Promise<BlobResult | null>;
}

// one instance, named "registry"
export declare class Registry extends DurableObject<Env> {
  upsert(name: string, idle: number): void;
  setConfig(name: string, cfg: RepoConfig, idle?: number): void;
  remove(name: string): void;
  get(name: string): RepoInfo | null;
  list(limit?: number, ns?: string): RepoInfo[];
}
