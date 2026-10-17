// @vitest-environment jsdom

import { ITEM_FILE_MAX_BYTES } from "@repo/notes/items/item-kind";
import { describe, expect, it } from "vitest";

import {
  FOLDER_REFUSAL,
  MAX_PASTED_LINKS,
  filesPayload,
  isEmptyPayload,
  payloadFrom,
} from "../capture-payload";
import type { TransferLike } from "../capture-payload";

interface FakeTransfer {
  data?: Record<string, string>;
  files?: File[];
  folders?: string[];
}

// a DataTransfer as a paste or a drop hands it over: its files, one item per file, its strings
const transfer = ({ data = {}, files = [], folders = [] }: FakeTransfer): TransferLike => ({
  files,
  getData: (format) => data[format] ?? "",
  items: files.map((file) => ({
    getAsFile: () => file,
    kind: "file",
    webkitGetAsEntry: () => ({ isDirectory: folders.includes(file.name) }),
  })),
});

const fileOf = (name: string, bytes = 4): File => new File([new Uint8Array(bytes)], name);

// a file the cap refuses, without holding its bytes
const oversized = (name: string): File => {
  const file = fileOf(name);
  Object.defineProperty(file, "size", { value: ITEM_FILE_MAX_BYTES + 1 });
  return file;
};

describe("what a paste or a drop holds", () => {
  it("is nothing when nothing came", () => {
    expect(isEmptyPayload(payloadFrom(null))).toBe(true);
    expect(isEmptyPayload(payloadFrom(transfer({ data: { "text/plain": "  " } })))).toBe(true);
  });

  it("takes the files over the link a dragged image carries too", () => {
    const image = fileOf("photo.png");
    const payload = payloadFrom(
      transfer({ data: { "text/uri-list": "https://example.com/photo.png" }, files: [image] }),
    );
    expect(payload.files).toEqual([image]);
    expect(payload.urls).toEqual([]);
  });

  it("refuses a folder and a file over the cap in the words the user reads", () => {
    const payload = payloadFrom(
      transfer({
        files: [fileOf("Trip"), oversized("Lecture.mp4"), fileOf("notes.pdf")],
        folders: ["Trip"],
      }),
    );
    expect(payload.files.map((file) => file.name)).toEqual(["notes.pdf"]);
    expect(payload.refused).toHaveLength(2);
    expect(payload.refused[0]).toBe(FOLDER_REFUSAL);
    expect(payload.refused[1]).toContain("“Lecture.mp4”");
  });

  it("reads the uri-list's links, skipping its comments and anything not on the web", () => {
    const payload = payloadFrom(
      transfer({
        data: {
          "text/uri-list": [
            "# a comment",
            "https://a.example/one",
            "file:///Users/kyh/secret.txt",
            "https://a.example/one",
            "mailto:someone@example.com",
            "https://b.example/two",
          ].join("\r\n"),
        },
      }),
    );
    expect(payload.urls).toEqual([
      { title: null, url: "https://a.example/one" },
      { title: null, url: "https://b.example/two" },
    ]);
  });

  it("titles a link from Firefox's pairs, else from the dragged anchor's text", () => {
    const payload = payloadFrom(
      transfer({
        data: {
          "text/html":
            '<a href="https://a.example/one">  Anchor   one </a><a href="https://b.example/two">Anchor two</a>',
          "text/uri-list": "https://a.example/one\nhttps://b.example/two",
          "text/x-moz-url": "https://b.example/two\nFirefox two",
        },
      }),
    );
    expect(payload.urls).toEqual([
      { title: "Anchor one", url: "https://a.example/one" },
      { title: "Firefox two", url: "https://b.example/two" },
    ]);
  });

  it("never runs what the dragged html carries", () => {
    const payload = payloadFrom(
      transfer({
        data: {
          "text/html": '<img src=x onerror="window.ran = true"><a href="https://a.example">A</a>',
          "text/uri-list": "https://a.example",
        },
      }),
    );
    expect(payload.urls).toEqual([{ title: "A", url: "https://a.example" }]);
    expect("ran" in window).toBe(false);
  });

  it("takes plain text only when every line is a web link", () => {
    expect(
      payloadFrom(transfer({ data: { "text/plain": "https://a.example\n\nhttps://b.example" } }))
        .urls,
    ).toEqual([
      { title: null, url: "https://a.example" },
      { title: null, url: "https://b.example" },
    ]);
    expect(
      payloadFrom(transfer({ data: { "text/plain": "read https://a.example later" } })).urls,
    ).toEqual([]);
  });

  it("keeps at most the paste's cap of links", () => {
    const many = Array.from(
      { length: MAX_PASTED_LINKS + 5 },
      (_, at) => `https://e.example/${String(at)}`,
    );
    expect(payloadFrom(transfer({ data: { "text/plain": many.join("\n") } })).urls).toHaveLength(
      MAX_PASTED_LINKS,
    );
  });
});

describe("what the file picker handed over", () => {
  it("holds a picked file to the same cap as a drop", () => {
    const kept = fileOf("a.pdf");
    const payload = filesPayload([kept, oversized("b.mov")]);
    expect(payload.files).toEqual([kept]);
    expect(payload.refused).toHaveLength(1);
    expect(payload.urls).toEqual([]);
  });
});
