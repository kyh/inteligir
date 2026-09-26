// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RevokeFailedNotice } from "../sync-section";

afterEach(cleanup);

describe("a sign-out the cloud did not take", () => {
  it("sends the person to the account's devices page to remove this device", () => {
    render(<RevokeFailedNotice cloudUrl="https://cloud.test" />);
    expect(screen.getByText(/could not remove itself from your account/u)).toBeDefined();
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://cloud.test/app/devices");
  });
});
