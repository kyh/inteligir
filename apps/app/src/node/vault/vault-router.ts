// The vault's handlers. Each one calls its service and answers the contract's
// output; a domain refusal becomes the wire class ONE table decides.
//
// THE TABLE IS THE POINT. Every refusal the vault can raise is a
// `VaultServiceError` code or a `VaultPathError`, and `VAULT_REFUSALS` below is
// TOTAL over both — `satisfies` makes a new class a compile error there, which
// is the one place "what does the wire call this?" has to be answered. Thirteen
// handlers deciding it separately is thirteen answers that can disagree, and a
// class nobody answered for becomes a silent 500. WHICH classes a given
// procedure can raise is still declared per row — in the contract, where the
// client reads it.

import { VaultPathError } from "@repo/notes/knowledge/vault-path";
import {
  VAULT_ASSET_MEDIA_TYPES,
  VAULT_ASSET_WRITE_MAX_BYTES,
  type VaultRenameResponse,
} from "@repo/api/local/vault/vault-schema";
import { ORPCError } from "@orpc/server";
import { base } from "../orpc";
import { listTrash, purgeTrashedNote, restoreNote, trashNote } from "./trash";
import {
  VaultServiceError,
  type GuardedWriteGuard,
  type VaultServiceErrorCode,
} from "./vault-service";

/** The composed rename (the link rewrite riding the service's rename); refusals
 *  surface as the same VaultPathError/VaultServiceError the service throws. */
export type RenameNote = (from: string, to: string) => Promise<VaultRenameResponse>;

/**
 * Every class the vault can refuse with, and the wire class it is. `@repo/notes`
 * sits BELOW the contract and cannot name one, so translating `VaultPathError`
 * is this layer's job.
 */
const VAULT_REFUSALS = {
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  too_large: "PAYLOAD_TOO_LARGE",
  invalid_path: "INVALID_PATH",
} as const satisfies Record<VaultServiceErrorCode | "invalid_path", string>;

/** A vault refusal as the wire class, or null for anything this layer has no
 *  name for — which is a 500, and should be. */
function asWireError(cause: unknown) {
  if (cause instanceof VaultPathError) {
    return new ORPCError(VAULT_REFUSALS.invalid_path, { message: cause.message });
  }
  if (cause instanceof VaultServiceError) {
    return new ORPCError(VAULT_REFUSALS[cause.code], { message: cause.message });
  }
  return null;
}

/** Runs `work`, re-raising a domain refusal as the class the contract declares.
 *  One wrapper rather than a try/catch per handler: the mapping is the table
 *  above, and repeating it is what made it drift. */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (cause) {
    throw asWireError(cause) ?? cause;
  }
}

/** The media type this extension is served as, or null for anything outside
 *  the allowlist. Lowercased, because a vault carries `.PNG` too. */
export function assetMediaType(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return VAULT_ASSET_MEDIA_TYPES.get(path.slice(dot).toLowerCase()) ?? null;
}

const tree = base.vault.tree.handler(({ context }) => context.vault.service.listTree());

const read = base.vault.read.handler(({ context, input }) =>
  refusing(() => context.vault.service.read(input.path)),
);

const write = base.vault.write.handler(async ({ context, input, errors }) =>
  refusing(async () => {
    if (input.expectedHash === undefined && input.ifAbsent === undefined) {
      return await context.vault.service.write(input.path, input.content);
    }
    const guard: GuardedWriteGuard =
      input.expectedHash === undefined ? { ifAbsent: true } : { expectedHash: input.expectedHash };
    const result = await context.vault.service.writeGuarded(input.path, input.content, guard);
    if (result.applied) {
      return { path: result.path };
    }
    if (result.reason === "exists") {
      throw errors.ALREADY_EXISTS({ message: `A file already exists at ${input.path}` });
    }
    // The client merges `current` with diff3 and retries — which is why the
    // guard lives in the protocol rather than in the UI. `current` is absent
    // when the file no longer exists at all.
    throw errors.CAS_MISMATCH({
      message: `${input.path} changed since the base this write was derived from`,
      data: result.current === null ? {} : { current: result.current },
    });
  }),
);

const assetWrite = base.vault.assetWrite.handler(async ({ context, input, errors }) => {
  if (assetMediaType(input.baseName) === null) {
    throw errors.INVALID_PATH({
      message: `${input.baseName} is not an image type this vault serves`,
    });
  }
  const byteLength = Math.floor((input.bytesBase64.length * 3) / 4);
  if (byteLength > VAULT_ASSET_WRITE_MAX_BYTES) {
    throw errors.PAYLOAD_TOO_LARGE({
      message: `attachment is ~${byteLength} bytes; the cap is ${VAULT_ASSET_WRITE_MAX_BYTES}`,
    });
  }
  const bytes = new Uint8Array(Buffer.from(input.bytesBase64, "base64"));
  return refusing(() => context.vault.service.writeAsset(input.dir, input.baseName, bytes));
});

const rename = base.vault.rename.handler(({ context, input }) =>
  refusing(() => context.renameNote(input.from, input.to)),
);

const mkdir = base.vault.mkdir.handler(({ context, input }) =>
  refusing(() => context.vault.service.createDir(input.path)),
);

const trashList = base.vault.trashList.handler(async ({ context }) => ({
  entries: await listTrash(context.vault.service),
}));

const trash = base.vault.trash.handler(({ context, input }) =>
  refusing(() => trashNote(context.vault.service, input.path)),
);

const trashRestore = base.vault.trashRestore.handler(({ context, input }) =>
  refusing(() => restoreNote(context.vault.service, input.path)),
);

const trashPurge = base.vault.trashPurge.handler(({ context, input }) =>
  refusing(async () => {
    await purgeTrashedNote(context.vault.service, input.path);
    return { ok: true } as const;
  }),
);

const remove = base.vault.remove.handler(({ context, input }) =>
  refusing(async () => {
    await context.vault.service.remove(input.path);
    return { ok: true } as const;
  }),
);

const status = base.vault.status.handler(({ context }) => context.vault.status());

const syncNow = base.vault.syncNow.handler(({ context }) => context.vault.syncNow());

export const vaultRouter = {
  tree,
  read,
  write,
  assetWrite,
  rename,
  mkdir,
  trashList,
  trash,
  trashRestore,
  trashPurge,
  remove,
  status,
  syncNow,
};
