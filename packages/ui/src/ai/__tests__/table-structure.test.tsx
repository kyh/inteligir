// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  DiffCell,
  DiffIncludedMark,
  DiffRow,
  DiffTableBody,
  DiffTableGrid,
  DiffTableHead,
  DiffTableHeadCell,
} from "../diff-table";
import {
  RecordsAddColumn,
  RecordsCell,
  RecordsColumnHeader,
  RecordsRow,
  RecordsTable,
  RecordsTableBody,
  RecordsTableHeader,
} from "../records-table";

const CELL_TAGS = new Set(["TD", "TH"]);
const CELL_ROLES = new Set(["cell", "columnheader", "gridcell", "rowheader"]);

const isCell = (element: Element): boolean => {
  const role = element.getAttribute("role");
  return role === null ? CELL_TAGS.has(element.tagName) : CELL_ROLES.has(role);
};

// a row owns cells alone: anything else in it is dropped by assistive tech, and a <tr> child
// that is not a cell is invalid HTML a parser would hoist out of the table
const strayRowChildren = (root: Element): string[] =>
  [...root.querySelectorAll('tr, [role="row"]')].flatMap((row) =>
    [...row.children]
      .filter((child) => !isCell(child))
      .map((child) => `${child.tagName.toLowerCase()} in ${row.tagName.toLowerCase()}`),
  );

afterEach(cleanup);

describe("a held table's rows hold cells alone", () => {
  it("RecordsTable, with a column you can add", () => {
    const { container } = render(
      <RecordsTable label="Notes">
        <RecordsTableHeader>
          <RecordsColumnHeader column="title" resizable={false}>
            Title
          </RecordsColumnHeader>
          <RecordsAddColumn />
        </RecordsTableHeader>
        <RecordsTableBody>
          <RecordsRow>
            <RecordsCell column="title">Alpha</RecordsCell>
          </RecordsRow>
        </RecordsTableBody>
      </RecordsTable>,
    );
    expect(strayRowChildren(container)).toEqual([]);
  });

  it("DiffTable, whose rows lead with the included mark and whose head names that column", () => {
    const { container, getByRole } = render(
      <DiffTableGrid>
        <DiffTableHead marks>
          <DiffTableHeadCell>Current</DiffTableHeadCell>
          <DiffTableHeadCell>Proposed</DiffTableHeadCell>
        </DiffTableHead>
        <DiffTableBody>
          <DiffRow change="added" included>
            <DiffIncludedMark />
            <DiffCell>draft</DiffCell>
            <DiffCell>review</DiffCell>
          </DiffRow>
        </DiffTableBody>
      </DiffTableGrid>,
    );
    expect(strayRowChildren(container)).toEqual([]);
    const [head, body] = [...container.querySelectorAll("tr")];
    expect(head?.children).toHaveLength(body?.children.length ?? -1);
    expect(getByRole("columnheader", { name: "Included" })).toBeDefined();
  });
});
