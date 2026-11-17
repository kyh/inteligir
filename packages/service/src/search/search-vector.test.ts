import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { searchVectorOf } from "./search-vector";
import type { SearchText } from "./search-vector";

const text = (fields: Partial<SearchText>): SearchText => ({
  body: "",
  headings: "",
  meta: "",
  title: "",
  ...fields,
});

describe(searchVectorOf, () => {
  it("weighs each field's words, title first, and shadows every word with its stem", () => {
    expect(
      searchVectorOf(text({ body: "budget", headings: "Plans", meta: "q3", title: "Hiring" })),
    ).toBe("'hiring':1A '~hire':1A 'plans':2B '~plan':2B 'q3':3C '~q3':3C 'budget':4 '~budget':4");
  });

  it("keeps a word once, at its first 64 places, each weighed by its field", () => {
    const vector = searchVectorOf(
      text({ body: Array.from({ length: 100 }, () => "go").join(" ") }),
    );
    const [word] = vector.split(" ");
    expect(word?.split(",")).toHaveLength(64);
    expect(searchVectorOf(text({ body: "run", title: "run" }))).toBe("'run':1A,2 '~run':1A,2");
  });

  it("passes over a word too long to be a lexeme, and puts every word past the last place at it", () => {
    expect(searchVectorOf(text({ body: `${"x".repeat(257)} kept` }))).toBe("'kept':1 '~kept':1");
    const late = searchVectorOf(
      text({ body: Array.from({ length: 16_400 }, (_, at) => `w${String(at)}`).join(" ") }),
    );
    expect(late).toContain("'w16382':16383");
    expect(late).toContain("'w16399':16383");
  });
});

const matchSchema = z.array(z.object({ hit: z.boolean() }));

const matches = async (vector: string, query: string): Promise<boolean> => {
  const [row] = matchSchema.parse(
    await db.execute(sql`select ${vector}::tsvector @@ ${query}::tsquery as hit`, "objects"),
  );
  return row?.hit ?? false;
};

dbSuite("a search vector in Postgres", () => {
  it("matches a typed prefix by the word, and a whole word by its stem", async () => {
    const vector = searchVectorOf(text({ body: "interviewing candidates for the budget" }));
    expect(await matches(vector, "'candid':*")).toBe(true);
    expect(await matches(vector, "'interviewer' | '~interview'")).toBe(true);
    expect(await matches(vector, "'budgeting' | '~budget'")).toBe(true);
    // a prefix never reaches into the shadows
    expect(await matches(vector, "'hire':*")).toBe(false);
  });

  it("ranks a title's hit ten times a body's", async () => {
    const ranks = z.array(z.object({ body: z.number(), title: z.number() }));
    const [row] = ranks.parse(
      await db.execute(
        sql`select ts_rank(${searchVectorOf(text({ title: "roadmap" }))}::tsvector, ${"'roadmap'"}::tsquery) as title,
          ts_rank(${searchVectorOf(text({ body: "roadmap" }))}::tsvector, ${"'roadmap'"}::tsquery) as body`,
        "objects",
      ),
    );
    expect((row?.title ?? 0) / (row?.body ?? 1)).toBeCloseTo(10);
  });

  it(
    "keeps a body far past the cap to its opening, within what Postgres stores",
    { timeout: 30_000 },
    async () => {
      const words = Array.from({ length: 1_000_000 }, (_, at) => `w${String(at)}`);
      const body = words.join(" ");
      expect(body.length).toBeGreaterThan(6 * 1024 * 1024);
      const vector = searchVectorOf(text({ body, title: "Long read" }));
      expect(await matches(vector, "'long' & 'w0'")).toBe(true);
      expect(await matches(vector, `'${words.at(-1) ?? ""}'`)).toBe(false);
    },
  );
});
