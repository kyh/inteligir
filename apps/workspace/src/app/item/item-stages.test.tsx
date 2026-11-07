// @vitest-environment jsdom

import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { toast } from "@repo/ui/components/sonner";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PageLibrary } from "../cloud/page-library";
import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import { FileStage } from "./item-stages";

const SHA = "c".repeat(64);
const BYTES = new Uint8Array([7, 8, 9]);
// jsdom makes no blob addresses, so the suite names the one the page would hand the link
const BLOB_ADDRESS = "blob:https://library.test/0199a4c2";

const fields = (patch: Partial<LibraryItemFields>): LibraryItemFields => ({
  aliases: [],
  author: null,
  copySha: null,
  coverSha: null,
  deletedAt: null,
  description: null,
  fetchError: null,
  fetchState: "none",
  fetchedAt: null,
  folderId: null,
  kind: "file",
  lang: null,
  originalName: "minutes.txt",
  originalSha: SHA,
  pinnedAt: null,
  properties: {},
  published: null,
  savedAt: 1_700_000_000_000,
  site: null,
  tags: [],
  title: "Minutes",
  url: null,
  ...patch,
});

// the link the page clicked to save, as the browser's download reads it
interface Saved {
  readonly href: string;
  readonly download: string;
}

let saved: Saved[] = [];

beforeEach(() => {
  saved = [];
  URL.createObjectURL = () => BLOB_ADDRESS;
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function record(
    this: HTMLAnchorElement,
  ) {
    saved.push({ download: this.download, href: this.href });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const drawn = (readFile: PageLibrary["readFile"]) => {
  const { library } = fakePageLibrary({ answer: () => ({}) });
  renderOnLibrary(<FileStage fields={fields({})} title="Minutes" />, { ...library, readFile });
};

describe("a file item's Download", () => {
  it("saves what the host reads under the file's own name, through a blob of the page's origin", async () => {
    const asked: string[] = [];
    drawn(async (sha) => {
      asked.push(sha);
      return await Promise.resolve(new Blob([BYTES]));
    });
    const button = screen.getByRole("button", { name: "Download minutes.txt" });
    // never a link to the file: on the Mac its address is another origin, which WebKit follows
    expect(button.closest("a")).toBeNull();
    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(saved).toStrictEqual([{ download: "minutes.txt", href: BLOB_ADDRESS }]);
    });
    expect(asked).toStrictEqual([SHA]);
  });

  it("saves nothing, and says so, when the file is not there to read", async () => {
    // the Mac's scheme, offline, for a file this Mac does not hold
    const said = vi.spyOn(toast, "error");
    drawn(async () => await Promise.reject(new Error("the file answered 502")));
    fireEvent.click(screen.getByRole("button", { name: "Download minutes.txt" }));
    await vi.waitFor(() => {
      expect(said).toHaveBeenCalledWith(
        "The file couldn't be saved. Check your connection and try again.",
      );
    });
    expect(saved).toStrictEqual([]);
  });
});
