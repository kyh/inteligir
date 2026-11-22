import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { toast, Toaster } from "@repo/ui/components/sonner";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "#components/theme-provider";

import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library.test-utils";
import { FileStage } from "./item-stages";

const SHA = "c".repeat(64);
const BYTES = new Uint8Array([7, 8, 9]);
const BLOB_ADDRESS = "blob:https://library.test/0199a4c2";

const fields = (patch: Partial<LibraryItemFields>) =>
  ({
    aliases: [],
    author: null,
    coverSha: null,
    deletedAt: null,
    description: null,
    parentId: null,
    kind: "file",
    lang: null,
    originalName: "minutes.txt",
    originalSha: SHA,
    pinnedAt: null,
    properties: {},
    published: null,
    reading: { state: "none" },
    savedAt: 1_700_000_000_000,
    site: null,
    tags: [],
    title: "Minutes",
    url: null,
    ...patch,
  }) satisfies LibraryItemFields;

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
  vi.restoreAllMocks();
});

const drawn = (answer: (request: Request) => Promise<Response>) => {
  const { library } = fakePageLibrary({});
  renderOnLibrary(
    <>
      <FileStage fields={fields({})} title="Minutes" />
      <ThemeProvider>
        <Toaster />
      </ThemeProvider>
    </>,
    {
      ...library,
      cloud: { ...library.cloud, fetch: answer },
    },
  );
};

describe("a file item's Download", () => {
  it("saves what the file's route answers under the file's own name, through a blob of the page's origin", async () => {
    const asked: string[] = [];
    drawn(async (request) => {
      asked.push(request.url);

      return await Promise.resolve(new Response(BYTES));
    });
    const button = screen.getByRole("button", { name: "Download minutes.txt" });
    expect(button.closest("a")).toBeNull();
    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(saved).toStrictEqual([{ download: "minutes.txt", href: BLOB_ADDRESS }]);
    });
    expect(asked).toStrictEqual([`https://library.test/v1/blobs/${SHA}`]);
  });

  it("saves nothing, and says so, when the file is not there to read", async () => {
    const said = vi.spyOn(toast, "error");
    drawn(async () => await Promise.resolve(new Response(null, { status: 502 })));
    fireEvent.click(screen.getByRole("button", { name: "Download minutes.txt" }));
    const refusal = "The file couldn't be saved. Check your connection and try again.";
    await screen.findByText(refusal);
    expect(said).toHaveBeenCalledWith(refusal);
    expect(saved).toStrictEqual([]);
  });
});
