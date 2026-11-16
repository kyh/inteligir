import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Value } from "platejs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getEditorHostIo } from "@repo/editor/host-io";
import { EditorHarness } from "./test-support/editor-harness";
import { FILES_ORIGIN, installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import type { FakeEditorHostOptions } from "@repo/editor/test-support/fake-editor-host";

const SHA = "a".repeat(64);
const VOID = [{ text: "" }];
const ADDRESS = `${FILES_ORIGIN}/${SHA}`;

// jsdom has no object URLs, which a Download hands its bytes to the system through
const saved: Blob[] = [];
beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: (blob: Blob) => {
      saved.push(blob);
      return "blob:saved";
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
});

afterAll(() => {
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

const mount = (
  value: Value,
  files: ReadonlyMap<string, Blob> = new Map(),
  options: Pick<FakeEditorHostOptions, "offline" | "savesFiles"> = {},
) => {
  saved.length = 0;
  const host = installFakeEditorHost({ files, ...options });
  const asked = vi.spyOn(getEditorHostIo(), "fileSrc");
  render(<EditorHarness value={value} />);
  return { asked, host };
};

describe("a picture in a note's text", () => {
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
  const cover = [{ caption: [{ text: "A cover" }], children: VOID, sha: SHA, type: "img" }];
  const NOT_HERE = "This picture isn't on this device yet.";

  it("draws from the address the host answers for its sha, as the page scrolls near it", async () => {
    mount(cover, new Map([[SHA, png]]));
    const picture = await screen.findByRole("img", { name: "A cover" });
    expect(picture.getAttribute("src")).toBe(ADDRESS);
    expect(picture.getAttribute("loading")).toBe("lazy");
  });

  it("says a picture the device cannot reach is not on it yet", async () => {
    mount([{ children: VOID, sha: SHA, type: "img" }]);
    await expect(screen.findByText(NOT_HERE)).resolves.toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("asks for a picture again once the host is back online, after an ask that failed offline", async () => {
    const { host } = mount(cover, new Map(), { offline: true });
    await expect(screen.findByText(NOT_HERE)).resolves.toBeTruthy();
    host.files.set(SHA, png);
    act(() => {
      host.goOffline(false);
    });
    const picture = await screen.findByRole("img", { name: "A cover" });
    expect(picture.getAttribute("src")).toBe(ADDRESS);
  });

  it("loads a picture again once the host is back online, after its address failed to load offline", async () => {
    const { host } = mount(cover, new Map([[SHA, png]]));
    const picture = await screen.findByRole("img", { name: "A cover" });
    act(() => {
      host.goOffline(true);
    });
    fireEvent.error(picture);
    await expect(screen.findByText(NOT_HERE)).resolves.toBeTruthy();
    act(() => {
      host.goOffline(false);
    });
    await expect(screen.findByRole("img", { name: "A cover" })).resolves.toBeTruthy();
  });

  it("asks for a picture it drew no more as the connection goes and comes back", async () => {
    const { asked, host } = mount(cover, new Map([[SHA, png]]));
    await screen.findByRole("img", { name: "A cover" });
    act(() => {
      host.goOffline(true);
    });
    act(() => {
      host.goOffline(false);
    });
    expect(screen.getByRole("img", { name: "A cover" }).getAttribute("src")).toBe(ADDRESS);
    expect(asked).toHaveBeenCalledOnce();
  });

  it("asks for no picture again that failed while online, which no connection brings", async () => {
    const { asked, host } = mount(cover);
    await expect(screen.findByText(NOT_HERE)).resolves.toBeTruthy();
    host.files.set(SHA, png);
    act(() => {
      host.goOffline(true);
    });
    act(() => {
      host.goOffline(false);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(NOT_HERE)).toBeTruthy();
    expect(asked).toHaveBeenCalledOnce();
  });

  it("loads no web picture, which the page's policy refuses, and asks the host for nothing", async () => {
    const url = "HTTPS://example.com/shot.png";
    const { asked } = mount([{ children: VOID, type: "img", url }]);
    await expect(screen.findByText("Web content, not loaded")).resolves.toBeTruthy();
    expect(screen.getByText(url)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("a recording in a note's text", () => {
  it("plays from the address the host answers for its sha", async () => {
    const mp4 = new Blob([new Uint8Array([0, 0, 0, 24])], { type: "video/mp4" });
    mount([{ children: VOID, sha: SHA, type: "video" }], new Map([[SHA, mp4]]));
    await waitFor(() => {
      expect(document.querySelector("video")?.getAttribute("src")).toBe(ADDRESS);
    });
  });
});

describe("a file in a note's text", () => {
  const pdf = new Blob(["%PDF-1.7"], { type: "application/pdf" });

  it("is a card naming the file, which reads no bytes until it is saved", async () => {
    const { asked } = mount([
      { children: VOID, name: "Lecture notes.pdf", sha: SHA, type: "file" },
    ]);
    await expect(screen.findByText("Lecture notes.pdf")).resolves.toBeTruthy();
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(asked).not.toHaveBeenCalled();
    expect(saved).toStrictEqual([]);
  });

  it("saves the file under its name from the bytes the host answers", async () => {
    mount(
      [{ children: VOID, name: "Lecture notes.pdf", sha: SHA, type: "file" }],
      new Map([[SHA, pdf]]),
    );
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockReturnValue();
    fireEvent.click(await screen.findByRole("button", { name: "Download" }));
    await waitFor(() => {
      expect(clicked).toHaveBeenCalledOnce();
    });
    const [link] = clicked.mock.contexts;
    expect(link instanceof HTMLAnchorElement ? link.download : null).toBe("Lecture notes.pdf");
    expect(saved).toStrictEqual([pdf]);
    clicked.mockRestore();
  });

  it("offers no Download where the host hands no file on", async () => {
    mount([{ children: VOID, name: "Lecture notes.pdf", sha: SHA, type: "file" }], new Map(), {
      savesFiles: false,
    });
    await expect(screen.findByText("Lecture notes.pdf")).resolves.toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });
});
