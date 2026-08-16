import type { Bridge } from "./ipc-contract";

// Module-level slot, filled once by whatever mounts the app (the ws bridge, or
// the fixture bridge a test drives) before the first render — the app never
// reaches for a transport itself.
let installed: Bridge | null = null;

/** Install the host's bridge. Called exactly once at boot, before render. */
export function installBridge(bridge: Bridge): void {
  installed = bridge;
}

/** Access the installed bridge. Both entry points install the bridge before
 * the first render, so any null here is a boot-order bug — throw loudly
 * instead of making every call site carry a dead guard. */
export function getBridge(): Bridge {
  if (installed === null) {
    throw new Error("getBridge() before installBridge — boot-order bug");
  }
  return installed;
}

/**
 * The second transport for attachment bytes: the same capability as
 * `writeVaultAsset`, moved off the socket.
 *
 * A file past `MAX_INLINE_ASSET_BYTES` cannot cross as base64 in one frame, so
 * the surface that mounted the app supplies the way it streams instead — it is
 * the only thing that knows where its host serves one. The answer is the same
 * `{ path }` the channel gives back, so a caller only picks the transport, not
 * a different outcome.
 */
export type AssetUpload = (asset: {
  readonly dir: string;
  readonly name: string;
  readonly body: Blob;
}) => Promise<{ readonly path: string }>;

let uploader: AssetUpload | null = null;

/** Install the streaming asset transport, beside the bridge, at boot. */
export function installAssetUpload(upload: AssetUpload): void {
  uploader = upload;
}

/** Access the installed asset transport. A surface that installed none can
 * still do everything a socket frame fits, so this throws at the one call that
 * needs it rather than at boot — and that throw is what the caller turns into a
 * message, never a silent no-op. */
export function getAssetUpload(): AssetUpload {
  if (uploader === null) {
    throw new Error("this app installed no way to upload a file that large");
  }
  return uploader;
}

/** Does a vault doc exist at `path`? A read that resolves means yes; any
 * rejection (absent, unreadable) means no — the caller only wants the
 * boolean, never the bytes or the error. */
export async function docExists(
  bridge: { readVaultFile(payload: { path: string }): Promise<string> },
  path: string,
): Promise<boolean> {
  try {
    await bridge.readVaultFile({ path });
    return true;
  } catch {
    return false;
  }
}
