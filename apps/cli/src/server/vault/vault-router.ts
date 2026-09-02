import {
  assetMediaType,
  VAULT_ASSET_MAX_BYTES,
  VAULT_HISTORY_DEFAULT_LIMIT,
  type VaultRenameResponse,
} from "@repo/api/local/vault/vault-schema";
import { base, refusals } from "../orpc";
import { vaultWireError } from "./vault-refusals";
import { listTrash, purgeTrashedNote, restoreNote, trashNote } from "./trash";
import type { GuardedWriteGuard } from "./vault-service";

export type RenameNote = (from: string, to: string) => Promise<VaultRenameResponse>;

const refusing = refusals(vaultWireError);

const tree = base.vault.tree.handler(({ context }) => context.vault.service.listTree());

const read = base.vault.read.handler(({ context, input }) =>
  refusing(() => context.vault.service.read(input.path)),
);

const history = base.vault.history.handler(async ({ context, input }) => ({
  revisions: await context.vault.git.history(input.path, {
    skip: input.skip ?? 0,
    limit: input.limit ?? VAULT_HISTORY_DEFAULT_LIMIT,
  }),
}));

const revision = base.vault.revision.handler(({ context, input }) =>
  refusing(async () => ({
    content: await context.vault.git.revision(input.path, input.sha),
  })),
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
    // the client merges current with diff3 and retries; current is absent when the file is gone.
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
  if (byteLength > VAULT_ASSET_MAX_BYTES) {
    throw errors.PAYLOAD_TOO_LARGE({
      message: `attachment is ~${byteLength} bytes; the cap is ${VAULT_ASSET_MAX_BYTES}`,
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

const commitNow = base.vault.commitNow.handler(async ({ context }) => ({
  files: (await context.vault.git.commitNow())?.files ?? 0,
}));

const status = base.vault.status.handler(({ context }) => context.vault.status());

const syncNow = base.vault.syncNow.handler(({ context }) => context.vault.syncNow());

export const vaultRouter = {
  tree,
  read,
  history,
  revision,
  write,
  assetWrite,
  rename,
  mkdir,
  trashList,
  trash,
  trashRestore,
  trashPurge,
  remove,
  commitNow,
  status,
  syncNow,
};
