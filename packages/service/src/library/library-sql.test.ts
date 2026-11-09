import { describe, expect, it } from "vitest";

import { utf8ByteLength } from "@repo/contract/library/canonical-json";
import {
  all,
  chunkStatement,
  run,
  runPlan,
  SQL_MAX_PARAMS,
  SQL_MAX_STATEMENT_BYTES,
} from "./library-sql";
import type { RepeatedStatement, SqlPlan, SqlValue } from "./library-sql";
import { mulberry32 } from "@repo/contract/test-support/seeded-random";
import { openWasmSqlPort, transactPlan } from "../test-support/wasm-sql-port";

const placeholders = (width: number): string =>
  `(${Array.from({ length: width }, () => "?").join(", ")})`;

describe(chunkStatement, () => {
  // 200 seeded statements, each up to 200 rows of wide text measured against both caps
  it(
    "never passes either cap, keeps every row in order and closes a statement only when full (seeded)",
    { timeout: 30_000 },
    () => {
      const rand = mulberry32(0x0c_4a_5c);
      for (let trial = 0; trial < 200; trial += 1) {
        const width = 1 + Math.floor(rand() * 40);
        const headParams = Array.from({ length: Math.floor(rand() * 5) }, (_, index) => index);
        // a wide row text stands for long column lists, so the text cap binds as well as the count
        const padding = " ".repeat(Math.floor(rand() * 9000));
        const statement: RepeatedStatement = {
          each: `${placeholders(width)}${padding}`,
          head: `INSERT INTO t ${headParams.map(() => "?").join(" ")} VALUES `,
          headParams,
          rows: Array.from({ length: Math.floor(rand() * 200) }, (_, row) =>
            Array.from({ length: width }, (__, column): SqlValue => row * 1000 + column),
          ),
          separator: rand() < 0.5 ? ", " : " OR ",
          tail: rand() < 0.5 ? "" : " ON CONFLICT DO NOTHING",
        };
        const chunks = chunkStatement(statement);
        const carried = chunks.flatMap((chunk) => chunk.params.slice(headParams.length));
        expect(carried).toStrictEqual(statement.rows.flat());
        for (const [index, chunk] of chunks.entries()) {
          expect(chunk.params.length).toBeLessThanOrEqual(SQL_MAX_PARAMS);
          expect(utf8ByteLength(chunk.sql)).toBeLessThanOrEqual(SQL_MAX_STATEMENT_BYTES);
          expect(chunk.params.slice(0, headParams.length)).toStrictEqual(headParams);
          const rowsIn = (chunk.params.length - headParams.length) / width;
          const oneMore =
            chunk.params.length + width > SQL_MAX_PARAMS ||
            utf8ByteLength(chunk.sql) +
              utf8ByteLength(statement.separator) +
              utf8ByteLength(statement.each) >
              SQL_MAX_STATEMENT_BYTES;
          // every chunk but the last is full: one more row would break a cap
          expect(oneMore || index === chunks.length - 1).toBe(true);
          expect(rowsIn).toBeGreaterThan(0);
        }
      }
    },
  );

  it("writes nothing for no rows, and refuses a row that cannot fit any statement", () => {
    expect(
      chunkStatement({ each: "(?)", head: "INSERT INTO t VALUES ", rows: [], separator: ", " }),
    ).toStrictEqual([]);
    expect(() =>
      chunkStatement({ each: placeholders(101), head: "X ", rows: [[]], separator: ", " }),
    ).toThrow(/limits/u);
    expect(() =>
      chunkStatement({ each: "(?, ?)", head: "X ", rows: [[1]], separator: ", " }),
    ).toThrow(/binds 1/u);
  });
});

const counting = function* counting(): SqlPlan<number> {
  yield run("CREATE TABLE n (v INTEGER) STRICT");
  yield run("INSERT INTO n (v) VALUES (?), (?)", [1, 2]);
  const [row] = yield all("SELECT sum(v) AS total FROM n");
  return Number(row?.total ?? 0);
};

const failing = function* failing(): SqlPlan<string> {
  yield run("CREATE TABLE f (v INTEGER NOT NULL) STRICT");
  try {
    yield run("INSERT INTO f (v) VALUES (?)", [null]);
  } catch {
    return "refused";
  }
  return "landed";
};

const broken = function* broken(): SqlPlan<void> {
  yield run("INSERT INTO n (v) VALUES (?)", [10]);
  throw new Error("stop");
};

describe(runPlan, () => {
  it("drives a plan over the port, handing each statement its rows", () => {
    expect(runPlan(openWasmSqlPort(), counting())).toBe(3);
  });

  it("throws an engine's refusal into the plan at its yield", () => {
    expect(runPlan(openWasmSqlPort(), failing())).toBe("refused");
  });

  it("lands nothing of a transaction that throws", () => {
    const port = openWasmSqlPort();
    runPlan(port, counting());
    expect(() => {
      transactPlan(port, broken());
    }).toThrow("stop");
    expect(port.all("SELECT count(*) AS rows FROM n", [])).toStrictEqual([{ rows: 2 }]);
  });
});
