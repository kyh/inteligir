// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ChoiceRow } from "../settings-chrome";

afterEach(cleanup);

type Theme = "system" | "light" | "dark";

const THEMES: readonly { value: Theme; label: string }[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const Harness = () => {
  const [theme, setTheme] = useState<Theme>("system");
  return <ChoiceRow label="Theme" options={THEMES} value={theme} onChange={setTheme} />;
};

const checked = (): string | null =>
  screen.getAllByRole("radio").find((radio) => radio.getAttribute("aria-checked") === "true")
    ?.textContent ?? null;

describe("the choice row", () => {
  it("is one radio group named by its label, the value checked", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeDefined();
    expect(checked()).toBe("System");
  });

  // waitFor: the group moves focus in a microtask, and the focus is what checks the radio.
  it("moves the choice with the arrow keys, as a radio group does", async () => {
    render(<Harness />);
    const system = screen.getByRole("radio", { name: "System" });
    system.focus();

    fireEvent.keyDown(system, { key: "ArrowRight" });
    await waitFor(() => {
      expect(checked()).toBe("Light");
    });
    const light = screen.getByRole("radio", { name: "Light" });
    expect(document.activeElement).toBe(light);

    fireEvent.keyDown(light, { key: "ArrowLeft" });
    await waitFor(() => {
      expect(checked()).toBe("System");
    });
  });

  it("is one tab stop: only the checked choice is in the tab order", () => {
    render(<Harness />);
    const tabbable = screen
      .getAllByRole("radio")
      .filter((radio) => radio.getAttribute("tabindex") === "0")
      .map((radio) => radio.textContent);
    expect(tabbable).toEqual(["System"]);
  });

  it("takes a click", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(checked()).toBe("Dark");
  });
});
