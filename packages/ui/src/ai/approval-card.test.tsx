import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApprovalCard } from "./approval-card";

const OPTIONS = [
  { label: "Allow", value: "allow" },
  { label: "Deny", value: "deny" },
] as const;

type Picked = (typeof OPTIONS)[number]["value"];

const renderCard = (picked: Picked | null) => {
  const onPick = vi.fn<(value: Picked) => void>();
  render(
    <ApprovalCard
      prompt="Run it?"
      detail="Twice."
      options={OPTIONS}
      picked={picked}
      onPick={onPick}
    />,
  );
  return onPick;
};

const option = (name: string): HTMLElement => screen.getByRole("button", { name });

describe(ApprovalCard, () => {
  it("hands a press to its caller and holds nothing of its own", () => {
    const onPick = renderCard(null);
    fireEvent.click(option("Deny"));
    expect(onPick).toHaveBeenCalledWith("deny");
    expect(option("Deny")).toHaveProperty("disabled", false);
    expect(option("Deny").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Twice.")).toBeDefined();
  });

  it("holds every option while one is picked, which reads pressed", () => {
    const onPick = renderCard("allow");
    expect(option("Allow").getAttribute("aria-pressed")).toBe("true");
    expect(option("Deny").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(option("Allow"));
    fireEvent.click(option("Deny"));
    expect(onPick).not.toHaveBeenCalled();
  });
});
