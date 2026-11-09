// A reading checked by the cell door's own schema before the consumer lands it: one the door takes
// goes as it is, and one it would refuse, which would land nothing and leave its item waiting, is
// said in the item as a page whose text couldn't be saved. The reader fits every field of every
// reading it makes (`./read-page`), so no page served to the consumer breaks a cap; a reading is
// built here instead.

import { TEXT_NOT_SAVED } from "@repo/service/items/fill-sentences";
import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FillJob } from "./fill-job";
import { checkedLanding } from "./fill-landing";
import type { FillLanding } from "./fill-landing";

afterEach(() => {
  vi.restoreAllMocks();
});

const JOB: FillJob = {
  accountId: "account-1",
  coverHint: null,
  itemId: "item-1",
  url: "https://pages.example/post",
};

const readingTitled = (title: string): FillLanding => ({
  article: [],
  coverSha: null,
  facts: { author: null, description: null, lang: null, published: null, site: null },
  finalUrl: JOB.url,
  itemId: JOB.itemId,
  kind: "read",
  playable: null,
  title,
  url: JOB.url,
});

describe("a reading the consumer lands", () => {
  it("goes to the cell as it is when the door takes it", () => {
    const reading = readingTitled("Keep your notes in files");
    expect(checkedLanding(JOB, reading)).toStrictEqual(reading);
  });

  it("is said as a page whose text couldn't be saved when the door would refuse it", () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(checkedLanding(JOB, readingTitled("t".repeat(ITEM_FIELD_CAPS.line + 1)))).toStrictEqual({
      itemId: JOB.itemId,
      kind: "failed",
      sentence: TEXT_NOT_SAVED,
      url: JOB.url,
    });
    expect(warned).toHaveBeenCalledWith({ event: "fill-landing-malformed", issues: 1 });
  });
});
