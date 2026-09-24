// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  RecordsCell,
  RecordsColumnHeader,
  RecordsRow,
  RecordsTable,
  RecordsTableBody,
  RecordsTableHeader,
} from "../records-table";

afterEach(cleanup);

describe("RecordsTable", () => {
  it("is a named table whose rows sit in row groups, and says a pending cell is filling", () => {
    render(
      <RecordsTable label="Notes">
        <RecordsTableHeader>
          <RecordsColumnHeader column="title" resizable={false}>
            Title
          </RecordsColumnHeader>
        </RecordsTableHeader>
        <RecordsTableBody>
          <RecordsRow>
            <RecordsCell column="title" pending />
          </RecordsRow>
        </RecordsTableBody>
      </RecordsTable>,
    );
    const table = screen.getByRole("table", { name: "Notes" });
    const groups = within(table).getAllByRole("rowgroup");
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(within(group).getAllByRole("row")).toHaveLength(1);
    }
    expect(within(table).getByRole("cell").textContent).toBe("Filling");
  });
});
