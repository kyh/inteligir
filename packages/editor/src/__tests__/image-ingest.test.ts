import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSlateEditor, ElementApi, KEYS } from "platejs";

import type * as HostIo from "@repo/editor/host-io";

import { registerLiveEditor } from "@repo/editor/live-editor";
import { stringProp } from "@repo/editor/node-props";

const helpers = vi.hoisted(() => ({
  writeVaultAsset: vi.fn(async () => await Promise.resolve({ path: "assets/landed.png" })),
}));

vi.mock("@repo/editor/host-io", async (importOriginal) => ({
  ...(await importOriginal<typeof HostIo>()),
  getEditorHostIo: () => ({ writeVaultAsset: helpers.writeVaultAsset }),
}));

vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));

const { toast } = await import("@repo/ui/components/sonner");
const { ingestImageFiles } = await import("@repo/editor/kits/image-kit");
const { EDITOR_KIT } = await import("@repo/editor/kits/editor-kit");

const unregisters: (() => void)[] = [];

// registered, as the mounted editor a paste reaches always is
const newEditor = () => {
  const editor = createSlateEditor({
    plugins: EDITOR_KIT,
    value: [{ children: [{ text: "" }], type: "p" }],
  });
  const unregister = registerLiveEditor("notes/pasted-into.md", editor);
  unregisters.push(unregister);
  return { editor, unregister };
};

const imageUrls = (editor: ReturnType<typeof newEditor>["editor"]): string[] =>
  editor.children.flatMap((node) => {
    if (!ElementApi.isElement(node) || node.type !== KEYS.img) {
      return [];
    }
    const url = stringProp(node, "url");
    return url === undefined ? [] : [url];
  });

const imageFile = (name: string, bytes: number): File =>
  new File([new Uint8Array(bytes)], name, { type: "image/png" });

describe("image ingestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const unregister of unregisters.splice(0)) {
      unregister();
    }
  });

  it("writes the bytes through the host and inserts the landed path", async () => {
    const { editor } = newEditor();
    const shot = imageFile("shot.png", 1024);

    await ingestImageFiles(editor, [shot]);

    expect(helpers.writeVaultAsset).toHaveBeenCalledWith({ baseName: "shot.png", file: shot });
    expect(imageUrls(editor)).toEqual(["assets/landed.png"]);
  });

  it("reports a refused write instead of rejecting into nothing", async () => {
    const { editor } = newEditor();
    helpers.writeVaultAsset.mockRejectedValueOnce(new Error("it is larger than this host accepts"));

    await expect(ingestImageFiles(editor, [imageFile("huge.png", 1024)])).resolves.toBeUndefined();

    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't add huge.png — it is larger than this host accepts",
    );
    expect(imageUrls(editor)).toEqual([]);
  });

  it("lands nothing in a note that closed while its image uploaded, and says where it went", async () => {
    const { editor, unregister } = newEditor();
    const upload = Promise.withResolvers<{ path: string }>();
    helpers.writeVaultAsset.mockReturnValueOnce(upload.promise);

    const ingest = ingestImageFiles(editor, [
      imageFile("late.png", 1024),
      imageFile("next.png", 8),
    ]);
    unregister();
    upload.resolve({ path: "assets/late.png" });
    await ingest;

    expect(imageUrls(editor)).toEqual([]);
    expect(helpers.writeVaultAsset).toHaveBeenCalledOnce();
    expect(toast.warning).toHaveBeenCalledWith(
      "Added assets/late.png to the vault, but its note closed before the image landed",
    );
  });
});
