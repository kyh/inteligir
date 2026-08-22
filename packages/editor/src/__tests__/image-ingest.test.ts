// Paste/drop image ingestion — the thing a fire-and-forget handler cannot get
// wrong: it NEVER REJECTS. Both handlers call it with `void` after
// `preventDefault`, and nothing on the page listens for an unhandled
// rejection — so a failure that escapes is a paste that produces no image and
// says nothing at all.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSlateEditor, KEYS } from "platejs";

const helpers = vi.hoisted(() => ({
  writeVaultAsset: vi.fn(() => Promise.resolve({ path: "assets/landed.png" })),
}));

vi.mock("@repo/editor/host-io", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/editor/host-io")>()),
  getEditorHostIo: () => ({ writeVaultAsset: helpers.writeVaultAsset }),
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

  it("writes the bytes through the host and inserts the landed path", async () => {
    const editor = newEditor();
    const shot = imageFile("shot.png", 1024);

    await ingestImageFiles(editor, [shot]);

    expect(helpers.writeVaultAsset).toHaveBeenCalledWith({
      dir: "assets",
      baseName: "shot.png",
      file: shot,
    });
    expect(imageUrls(editor)).toEqual(["assets/landed.png"]);
  });

  it("reports a refused write instead of rejecting into nothing", async () => {
    const editor = newEditor();
    helpers.writeVaultAsset.mockRejectedValueOnce(new Error("it is larger than this host accepts"));

    await expect(ingestImageFiles(editor, [imageFile("huge.png", 1024)])).resolves.toBeUndefined();

    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't add huge.png — it is larger than this host accepts",
    );
    expect(imageUrls(editor)).toEqual([]);
  });
});
