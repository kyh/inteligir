// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RenderCrash } from "./render-crash";
import { fakePageLibrary, renderOnLibrary } from "./test-support/fake-page-library";

afterEach(cleanup);

const crashedHolding = (unsent: number): void => {
  const { library } = fakePageLibrary({ answer: () => ({}) });
  const status = { ...library.replica.status(), unsent };
  renderOnLibrary(<RenderCrash error={new Error("a screen threw")} reset={() => {}} />, {
    ...library,
    replica: { ...library.replica, status: () => status },
  });
};

describe("the crash screen", () => {
  it("says a reload loses what the tab has not sent", () => {
    crashedHolding(2);
    expect(screen.getByText(/reloading the page now loses them/u)).toBeTruthy();
  });
});
