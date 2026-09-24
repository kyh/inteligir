import { render } from "@testing-library/react";
import { KEYS } from "platejs";
import { createPlateEditor, Plate, PlateContent } from "platejs/react";
import { describe, expect, it } from "vitest";

import { DateKit } from "@repo/editor/kits/date-kit";

const chipText = (date: string): string => {
  const editor = createPlateEditor({
    plugins: DateKit,
    value: [
      {
        children: [{ text: "" }, { children: [{ text: "" }], date, type: KEYS.date }, { text: "" }],
        type: KEYS.p,
      },
    ],
  });
  const { container } = render(
    <Plate editor={editor}>
      <PlateContent />
    </Plate>,
  );
  return container.textContent ?? "";
};

describe("the date chip", () => {
  it("shows an impossible date as its raw text, never the day it rolls into", () => {
    expect(chipText("2026-02-31")).toContain("2026-02-31");
  });

  it("draws a real date as a date, not as its bytes", () => {
    expect(chipText("2026-02-28")).not.toContain("2026-02-28");
  });
});
