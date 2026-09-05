// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SecondVaultNote } from "../settings-chrome";

afterEach(cleanup);

describe("the second-vault note", () => {
  it("says why a vault of its own starts empty", () => {
    render(<SecondVaultNote scope="vault" />);
    expect(screen.getByText(/second vault with a data dir of its own/u)).toBeDefined();
  });

  it("says nothing on the default vault, and nothing before the status answers", () => {
    const { rerender } = render(<SecondVaultNote scope="root" />);
    expect(screen.queryByText(/second vault/u)).toBeNull();
    rerender(<SecondVaultNote scope={undefined} />);
    expect(screen.queryByText(/second vault/u)).toBeNull();
  });
});
