// Paste/drop image ingestion — the two things a fire-and-forget handler cannot
// get wrong twice.
//
//   1. The TRANSPORT is picked by size. `writeVaultAsset` puts the bytes as
//      base64 in one socket frame and the host refuses a frame past
//      MAX_INLINE_ASSET_BYTES, so a photo that goes there produces a rejection
//      instead of an image.
//   2. Ingestion NEVER REJECTS. Both handlers call it with `void` after
//      `preventDefault`, and nothing on the page listens for an unhandled
//      rejection — so a failure that escapes is a paste that produces no image
//      and says nothing at all.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSlateEditor, KEYS } from "platejs";

import { MAX_INLINE_ASSET_BYTES } from "@repo/bridge/vault";

const helpers = vi.hoisted(() => ({
  writeVaultAsset: vi.fn(() => Promise.resolve({ path: "assets/framed.png" })),
  upload: vi.fn(() => Promise.resolve({ path: "assets/streamed.png" })),
}));

vi.mock("@repo/bridge/client", () => ({
  getBridge: () => ({ writeVaultAsset: helpers.writeVaultAsset }),
  getAssetUpload: () => helpers.upload,
}));

vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
}));

const { toast } = await import("@repo/ui/components/sonner");
const { ingestImageFiles } = await import("@repo/editor/kits/image-kit");
const { EDITOR_KIT } = await import("@repo/editor/kits/editor-kit");

function newEditor() {
  return createSlateEditor({
    plugins: EDITOR_KIT,
    value: [{ children: [{ text: "" }], type: "p" }],
  });
}

/** Every image node's url, in document order. */
function imageUrls(editor: ReturnType<typeof newEditor>): string[] {
  return editor.children.flatMap((node) =>
    "type" in node && node.type === KEYS.img && "url" in node && typeof node.url === "string"
      ? [node.url]
      : [],
  );
}

function imageFile(name: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

describe("image ingestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams a file past the inline cap instead of framing it", async () => {
    const editor = newEditor();
    const photo = imageFile("photo.png", MAX_INLINE_ASSET_BYTES + 1);

    await ingestImageFiles(editor, [photo]);

    expect(helpers.writeVaultAsset).not.toHaveBeenCalled();
    expect(helpers.upload).toHaveBeenCalledWith({
      dir: "assets",
      name: "photo.png",
      body: photo,
    });
    // The node still lands, so the paste produced an image either way.
    expect(imageUrls(editor)).toEqual(["assets/streamed.png"]);
  });

  it("keeps a file within the cap on the socket frame", async () => {
    const editor = newEditor();

    await ingestImageFiles(editor, [imageFile("shot.png", 1024)]);

    expect(helpers.upload).not.toHaveBeenCalled();
    expect(helpers.writeVaultAsset).toHaveBeenCalledWith({
      dir: "assets",
      baseName: "shot.png",
      bytesBase64: btoa("\0".repeat(1024)),
    });
    expect(imageUrls(editor)).toEqual(["assets/framed.png"]);
  });

  it("reports a refused write instead of rejecting into nothing", async () => {
    const editor = newEditor();
    helpers.upload.mockRejectedValueOnce(new Error("it is larger than this host accepts"));

    await expect(
      ingestImageFiles(editor, [imageFile("huge.png", MAX_INLINE_ASSET_BYTES + 1)]),
    ).resolves.toBeUndefined();

    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't add huge.png — it is larger than this host accepts",
    );
    expect(imageUrls(editor)).toEqual([]);
  });
});
