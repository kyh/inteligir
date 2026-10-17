import { describe, expect, it } from "vitest";

import { composeLinkBody } from "../../items/item-body";
import { composeItemFile } from "../../items/item-frontmatter";
import type { ItemFileFields } from "../../items/item-frontmatter";
import { diff3 } from "../../text/diff3";
import { mergeItemTexts, urlItemVerdict } from "../url-item-verdict";

const ID = "7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17";
const URL = "https://stephango.com/file-over-app";
const SAVED = "2026-10-17T09:12:30Z";
const COVER_1 = "assets/covers/3f9a0c2b1d4e5f60.jpg";
const COVER_2 = "assets/covers/9c1d0a7b6e5f4c3d.jpg";
const ARTICLE = "File over app is a philosophy: if you want to create digital artifacts that last.";
const DESCRIPTION = "Files you can control, in formats that are easy to retrieve and read.";

const doc = (...lines: string[]): string => `${lines.join("\n")}\n`;

interface Version {
  readonly fields?: ItemFileFields;
  readonly cover?: string | null;
  readonly note?: string;
  readonly article?: string;
}

// a stub as the phone's share writes it
const stub = ({ fields = {}, note = "" }: Version = {}): string =>
  composeItemFile(
    { id: ID, kind: "link", saved: SAVED, url: URL, ...fields },
    composeLinkBody({ article: "", copy: null, cover: null, note }),
  );

// the same item after a fill, as the Mac writes it
const filled = (
  fetched: string,
  { fields = {}, cover = COVER_1, note = "", article = ARTICLE }: Version = {},
): string =>
  composeItemFile(
    {
      description: DESCRIPTION,
      fetched,
      id: ID,
      kind: "link",
      saved: SAVED,
      site: "Steph Ango",
      url: URL,
      ...fields,
    },
    composeLinkBody({ article, copy: null, cover, note }),
  );

// both askers, both orientations: the answer must be the same bytes
const settle = (base: string | null, one: string, other: string): string | null => {
  const forward = urlItemVerdict({ base, mine: one, theirs: other });
  const backward = urlItemVerdict({ base, mine: other, theirs: one });
  expect(backward).toBe(forward);
  return forward;
};

describe("urlItemVerdict, one side changed the fill (B)", () => {
  it("carries a stub's tag and note onto its first fill, the note right after the cover", () => {
    const base = stub();
    const phone = stub({ fields: { tags: ["read"] }, note: "For Tuesday." });
    const mac = filled("2026-10-17T09:12:33Z");
    expect(settle(base, phone, mac)).toBe(
      doc(
        "---",
        `id: ${ID}`,
        "kind: link",
        `url: ${URL}`,
        "site: Steph Ango",
        `saved: ${SAVED}`,
        "fetched: 2026-10-17T09:12:33Z",
        `description: ${DESCRIPTION}`,
        "tags:",
        "  - read",
        "---",
        "",
        `![](${COVER_1})`,
        "",
        "For Tuesday.",
        "",
        ARTICLE,
      ),
    );
  });

  it("puts the person's rewrite of the stub's note where the fill carried the old one", () => {
    const base = stub({ note: "For Tuesday." });
    const phone = stub({ note: "For Tuesday, with Sam.\nBring the printout." });
    const mac = filled("2026-10-17T09:12:33Z", { note: "For Tuesday." });
    expect(settle(base, phone, mac)).toBe(
      filled("2026-10-17T09:12:33Z", { note: "For Tuesday, with Sam.\nBring the printout." }),
    );
  });

  it("keeps a refresh's keys and cover and the phone's tag and note, and the older fill never comes back", () => {
    const base = filled("2026-10-17T09:12:33Z", { note: "For Tuesday." });
    const phone = filled("2026-10-17T09:12:33Z", {
      fields: { tags: ["read"] },
      note: "For Tuesday, with Sam.",
    });
    const refresh = filled("2026-10-18T08:00:00Z", {
      cover: COVER_2,
      fields: { description: "A newer summary." },
      note: "For Tuesday.",
    });
    expect(settle(base, phone, refresh)).toBe(
      filled("2026-10-18T08:00:00Z", {
        cover: COVER_2,
        fields: { description: "A newer summary.", tags: ["read"] },
        note: "For Tuesday, with Sam.",
      }),
    );
  });

  it("lands the refresh's keys and the person's typing on the editor's retry after Refresh", () => {
    const loaded = filled("2026-10-17T09:12:33Z");
    const buffer = `${loaded}\nMy own thoughts, typed after pressing Refresh.\n`;
    const refresh = filled("2026-10-18T08:00:00Z", { cover: COVER_2 });
    const merged = mergeItemTexts(loaded, buffer, refresh);
    expect(merged).toEqual({
      conflicted: false,
      merged: `${refresh}\nMy own thoughts, typed after pressing Refresh.\n`,
    });
    expect(urlItemVerdict({ base: loaded, mine: refresh, theirs: buffer })).toBe(merged.merged);
  });

  it("keeps a description the person edited unless the refresh changed it too", () => {
    const base = filled("2026-10-17T09:12:33Z");
    const edited = filled("2026-10-17T09:12:33Z", {
      fields: { description: "Mine, in my words." },
    });
    const sameDescription = filled("2026-10-18T08:00:00Z", { cover: COVER_2 });
    expect(settle(base, edited, sameDescription)).toBe(
      filled("2026-10-18T08:00:00Z", {
        cover: COVER_2,
        fields: { description: "Mine, in my words." },
      }),
    );
    const newDescription = filled("2026-10-18T08:00:00Z", {
      cover: COVER_2,
      fields: { description: "The page's newer summary." },
    });
    expect(settle(base, edited, newDescription)).toBe(newDescription);
  });

  it("answers null for a refresh that replaced the text against a person's edit of it", () => {
    const base = filled("2026-10-17T09:12:33Z", { article: "The old article." });
    const edited = filled("2026-10-17T09:12:33Z", {
      article: "The old article, and my aside inside it.",
    });
    const replaced = filled("2026-10-18T08:00:00Z", { article: "The article, rewritten." });
    expect(settle(base, edited, replaced)).toBeNull();
  });

  it("keeps a tag the person removed removed", () => {
    const base = stub({ fields: { tags: ["read", "later"] } });
    const phone = stub({ fields: { tags: ["read"] } });
    const mac = filled("2026-10-17T09:12:33Z", { fields: { tags: ["read", "later"] } });
    expect(settle(base, phone, mac)).toBe(
      filled("2026-10-17T09:12:33Z", { fields: { tags: ["read"] } }),
    );
  });

  it("adopts the id the other side minted when the fill carries none", () => {
    // a link note an opened folder held, with no id: one Mac annotated it, another refreshed it
    const base = doc("---", "kind: link", `url: ${URL}`, "---", "", "Mine.");
    const annotated = doc("---", `id: ${ID}`, "kind: link", `url: ${URL}`, "---", "", "Mine.");
    const refreshed = doc(
      "---",
      "kind: link",
      `url: ${URL}`,
      "fetched: 2026-10-18T08:00:00Z",
      "---",
      "",
      "Mine.",
    );
    expect(settle(base, annotated, refreshed)).toBe(
      doc(
        "---",
        `id: ${ID}`,
        "kind: link",
        `url: ${URL}`,
        "fetched: 2026-10-18T08:00:00Z",
        "---",
        "",
        "Mine.",
      ),
    );
  });

  it("carries a person's own key and a pin onto the fill", () => {
    const base = stub();
    const pinned = stub({ fields: { pinned: true } });
    const mac = filled("2026-10-17T09:12:33Z");
    expect(settle(base, pinned, mac)).toBe(
      filled("2026-10-17T09:12:33Z", { fields: { pinned: true } }),
    );
    const sourced = `${stub().replace("---\n", "---\nproject: Q3 plan\n")}`;
    expect(settle(base, sourced, mac)).toBe(
      filled("2026-10-17T09:12:33Z").replace(
        `description: ${DESCRIPTION}\n`,
        `description: ${DESCRIPTION}\nproject: Q3 plan\n`,
      ),
    );
  });

  it("settles a link that one side's fill turned into a PDF item", () => {
    const pdfUrl = "https://example.org/paper.pdf";
    const base = stub({ fields: { url: pdfUrl } });
    const phone = stub({ fields: { tags: ["paper"], url: pdfUrl } });
    const mac = composeItemFile(
      { fetched: "2026-10-17T09:12:33Z", id: ID, kind: "pdf", saved: SAVED, url: pdfUrl },
      "![](assets/paper.pdf)\n",
    );
    expect(settle(base, phone, mac)).toBe(
      composeItemFile(
        {
          fetched: "2026-10-17T09:12:33Z",
          id: ID,
          kind: "pdf",
          saved: SAVED,
          tags: ["paper"],
          url: pdfUrl,
        },
        "![](assets/paper.pdf)\n",
      ),
    );
  });

  it("carries the phone's note onto a failed fill", () => {
    const base = stub();
    const phone = stub({ note: "Ask Sam about this one." });
    const failed = composeItemFile(
      {
        fetched: "2026-10-17T09:12:33Z",
        "fetch-error": "The page did not answer.",
        id: ID,
        kind: "link",
        saved: SAVED,
        url: URL,
      },
      "",
    );
    expect(settle(base, phone, failed)).toBe(`${failed}\nAsk Sam about this one.\n`);
  });
});

describe("urlItemVerdict, both changed the fill (A)", () => {
  it("lets the earlier fetch win when two Macs fill one stub", () => {
    const base = stub();
    const early = filled("2026-10-17T09:12:33Z");
    const late = filled("2026-10-17T09:12:41Z", { cover: COVER_2 });
    expect(settle(base, early, late)).toBe(early);
    expect(settle(base, late, early)).toBe(early);
  });

  it("lets the earlier fetch win when two refreshes of one fill race", () => {
    const base = filled("2026-10-17T09:12:33Z");
    const first = filled("2026-10-18T08:00:00Z", { cover: COVER_2 });
    const second = filled("2026-10-18T08:00:05Z", { article: "The page, a little later." });
    expect(settle(base, first, second)).toBe(first);
  });

  it("orders two fetches of one second by how each is written", () => {
    const base = stub();
    const plain = filled("2026-10-17T09:12:33Z");
    const offset = filled("2026-10-17T10:12:33+01:00", { cover: COVER_2 });
    expect(settle(base, plain, offset)).toBe(plain);
  });

  it("keeps a tag the loser removed removed and one it added added", () => {
    const base = filled("2026-10-17T09:12:33Z", { fields: { tags: ["read", "later"] } });
    const winner = filled("2026-10-18T08:00:00Z", { fields: { tags: ["read", "later"] } });
    const loser = filled("2026-10-18T08:00:05Z", { fields: { tags: ["read", "q3"] } });
    expect(settle(base, winner, loser)).toBe(
      filled("2026-10-18T08:00:00Z", { fields: { tags: ["read", "q3"] } }),
    );
  });

  it("settles two devices adding one link with no common version: the fill, the earlier save, the stub's tag and note", () => {
    const phone = composeItemFile(
      {
        id: "0e5b3c1a-9a51-4f0e-8a0c-0b7f9d3a2c11",
        kind: "link",
        saved: "2026-10-17T09:10:00Z",
        tags: ["read"],
        url: "https://stephango.com/file-over-app?utm_source=share",
      },
      "For Tuesday.\n",
    );
    const mac = filled("2026-10-17T09:12:33Z");
    expect(settle(null, phone, mac)).toBe(
      filled("2026-10-17T09:12:33Z", {
        fields: { saved: "2026-10-17T09:10:00Z", tags: ["read"] },
        note: "For Tuesday.",
      }),
    );
  });

  it("settles two stubs of one link with no common version on the earlier save", () => {
    const early = composeItemFile(
      { id: ID, kind: "link", saved: "2026-10-17T09:10:00Z", url: URL },
      "Mine.\n",
    );
    const late = composeItemFile(
      { id: "0e5b3c1a-9a51-4f0e-8a0c-0b7f9d3a2c11", kind: "link", saved: SAVED, url: `${URL}#top` },
      "Theirs.\n",
    );
    expect(settle(null, early, late)).toBe(`${early.replace("Mine.\n", "Mine.\n\nTheirs.\n")}`);
  });

  it("takes the minimum `saved` whichever side carries it", () => {
    const base = stub();
    const resaved = filled("2026-10-17T09:12:33Z", { fields: { saved: "2026-10-01T00:00:00Z" } });
    const late = filled("2026-10-17T09:12:40Z", { cover: COVER_2 });
    expect(settle(base, resaved, late)).toBe(resaved);
    const early = filled("2026-10-17T09:12:30Z", { cover: COVER_2 });
    expect(settle(base, resaved, early)).toBe(
      filled("2026-10-17T09:12:30Z", {
        cover: COVER_2,
        fields: { saved: "2026-10-01T00:00:00Z" },
      }),
    );
  });
});

describe("urlItemVerdict, where it does not apply", () => {
  it("answers null for notes", () => {
    const base = doc("# Plan", "one");
    expect(settle(base, doc("# Plan", "two"), doc("# Plan", "three"))).toBeNull();
    expect(settle(null, doc("# Plan", "two"), doc("# Plan", "three"))).toBeNull();
  });

  it("answers null for two different links", () => {
    const other = filled("2026-10-17T09:12:33Z", { fields: { url: "https://example.org/x" } });
    expect(settle(stub(), filled("2026-10-17T09:12:30Z"), other)).toBeNull();
    expect(settle(null, stub(), other)).toBeNull();
  });

  it("answers null for a base that names another link or none", () => {
    const moved = stub({ fields: { url: "https://example.org/x" } });
    expect(settle(moved, stub(), filled("2026-10-17T09:12:33Z"))).toBeNull();
    expect(settle(doc("# Notes"), stub(), filled("2026-10-17T09:12:33Z"))).toBeNull();
  });

  it("answers null when neither side changed the fill, so the person's edits go to diff3", () => {
    const base = filled("2026-10-17T09:12:33Z");
    const tagged = filled("2026-10-17T09:12:33Z", { fields: { tags: ["read"] } });
    const noted = filled("2026-10-17T09:12:33Z", { note: "Mine." });
    expect(settle(base, tagged, noted)).toBeNull();
    expect(mergeItemTexts(base, tagged, noted)).toEqual(diff3(base, tagged, noted));
  });

  it("answers null when both changed the fill to the same mark", () => {
    const base = stub();
    const one = filled("2026-10-17T09:12:33Z");
    const other = filled("2026-10-17T09:12:33Z", { cover: COVER_2 });
    expect(settle(base, one, other)).toBeNull();
  });

  it("answers null for a block it cannot read", () => {
    const broken = "---\nkind: link\nurl: [unclosed\n---\n";
    expect(settle(stub(), broken, filled("2026-10-17T09:12:33Z"))).toBeNull();
  });
});

describe("mergeItemTexts", () => {
  it("is diff3 for a note", () => {
    const base = doc("# Plan", "", "alpha", "", "omega");
    const mine = doc("# Plan", "", "alpha, mine", "", "omega");
    const theirs = doc("# Plan", "", "alpha", "", "omega, theirs");
    expect(mergeItemTexts(base, mine, theirs)).toEqual(diff3(base, mine, theirs));
  });
});

describe("urlItemVerdict, whichever device asks", () => {
  // every version one saved link passes through, met pairwise over every base
  const versions = [
    stub(),
    stub({ note: "For Tuesday." }),
    stub({ fields: { tags: ["read"] }, note: "For Tuesday, with Sam." }),
    stub({ fields: { pinned: true, saved: "2026-10-17T09:10:00Z" } }),
    filled("2026-10-17T09:12:33Z"),
    filled("2026-10-17T09:12:33Z", { fields: { tags: ["read", "later"] }, note: "For Tuesday." }),
    filled("2026-10-17T09:12:41Z", { cover: COVER_2 }),
    filled("2026-10-17T09:12:41Z", { cover: null, fields: { description: "Mine." } }),
    filled("2026-10-18T08:00:00Z", { article: "The article, rewritten.", cover: COVER_2 }),
    filled("2026-10-18T08:00:00Z", { fields: { "fetch-error": "The page did not answer." } }),
    `${filled("2026-10-17T09:12:33Z")}\nTyped after the fill.\n`,
  ];

  it("answers the same bytes from both sides of every pair", () => {
    const asymmetric: { base: string | null; one: string; other: string }[] = [];
    for (const base of [null, ...versions]) {
      for (const [i, one] of versions.entries()) {
        for (const other of versions.slice(i + 1)) {
          const forward = urlItemVerdict({ base, mine: one, theirs: other });
          if (urlItemVerdict({ base, mine: other, theirs: one }) !== forward) {
            asymmetric.push({ base, one, other });
          }
        }
      }
    }
    expect(asymmetric).toEqual([]);
  });
});
