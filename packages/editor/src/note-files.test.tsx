// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Value } from "platejs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { EditorHarness } from "./test-support/editor-harness";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import type { FakeEditorHostOptions } from "@repo/editor/test-support/fake-editor-host";

const SHA = "a".repeat(64);
const VOID = [{ text: "" }];

// jsdom has no object URLs: each Blob the editor draws gets an address naming the order it came in
const drawn: Blob[] = [];
const created = vi.fn<(blob: Blob) => string>((blob) => {
  drawn.push(blob);
  return `blob:test/${String(drawn.length)}`;
});
const revoked = vi.fn<(url: string) => void>();

beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: created });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoked });
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
  drawn.length = 0;
  const host = installFakeEditorHost({ files, ...options });
  render(<EditorHarness value={value} />);
  return host;
};

describe("a picture in a note's text", () => {
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
  const cover = [{ caption: [{ text: "A cover" }], children: VOID, sha: SHA, type: "img" }];
  const NOT_HERE = "This picture isn't on this device yet.";

  it("draws the bytes the host answers for its sha", async () => {
    mount(cover, new Map([[SHA, png]]));
    const picture = await screen.findByRole("img", { name: "A cover" });
    expect(picture.getAttribute("src")).toBe("blob:test/1");
    expect(drawn).toStrictEqual([png]);
  });

  it("says a picture the device cannot reach is not on it yet", async () => {
    mount([{ children: VOID, sha: SHA, type: "img" }]);
    await expect(screen.findByText(NOT_HERE)).resolves.toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("reads a picture again once the host is back online, after a read that failed offline", async () => {
    const host = mount(cover, new Map(), { offline: true });
    await expect(screen.findByText(NOT_HERE)).resolves.toBeTruthy();
    host.files.set(SHA, png);
    act(() => {
      host.goOffline(false);
    });
    const picture = await screen.findByRole("img", { name: "A cover" });
    expect(picture.getAttribute("src")).toBe("blob:test/1");
  });

  it("reads a picture it drew no more as the connection goes and comes back", async () => {
    const host = mount(cover, new Map([[SHA, png]]));
    await screen.findByRole("img", { name: "A cover" });
    act(() => {
      host.goOffline(true);
    });
    act(() => {
      host.goOffline(false);
    });
    expect(screen.getByRole("img", { name: "A cover" }).getAttribute("src")).toBe("blob:test/1");
    expect(drawn).toStrictEqual([png]);
  });

  it("reads no picture again that failed while online, which no connection brings", async () => {
    const host = mount(cover);
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
    expect(drawn).toStrictEqual([]);
  });

  it("loads no web picture, which the page's policy refuses, and asks the host for nothing", async () => {
    const url = "HTTPS://example.com/shot.png";
    mount([{ children: VOID, type: "img", url }]);
    await expect(screen.findByText("Web content, not loaded")).resolves.toBeTruthy();
    expect(screen.getByText(url)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(drawn).toStrictEqual([]);
  });
});

describe("a recording in a note's text", () => {
  it("plays the bytes the host answers for its sha", async () => {
    const mp4 = new Blob([new Uint8Array([0, 0, 0, 24])], { type: "video/mp4" });
    mount([{ children: VOID, sha: SHA, type: "video" }], new Map([[SHA, mp4]]));
    await waitFor(() => {
      expect(document.querySelector("video")?.getAttribute("src")).toBe("blob:test/1");
    });
  });
});

describe("a file in a note's text", () => {
  const pdf = new Blob(["%PDF-1.7"], { type: "application/pdf" });

  it("is a card naming the file, which reads no bytes until it is saved", async () => {
    mount([{ children: VOID, name: "Lecture notes.pdf", sha: SHA, type: "file" }]);
    await expect(screen.findByText("Lecture notes.pdf")).resolves.toBeTruthy();
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(drawn).toStrictEqual([]);
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
    expect(drawn).toStrictEqual([pdf]);
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
