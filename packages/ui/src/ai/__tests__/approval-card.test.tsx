// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApprovalCard, ApprovalOption, ApprovalQuestion } from "../approval-card";
import type { ApprovalAnswer } from "../approval-card";

afterEach(cleanup);

type Submit = (answers: ApprovalAnswer[]) => void | Promise<void>;

const renderCard = (onSubmit: Submit): void => {
  render(
    <ApprovalCard onSubmit={onSubmit} sentLabel="Answered">
      <ApprovalQuestion questionId="q1" prompt="Run it?" kind="radio">
        <ApprovalOption optionId="allow">Allow</ApprovalOption>
        <ApprovalOption optionId="deny">Deny</ApprovalOption>
      </ApprovalQuestion>
    </ApprovalCard>,
  );
};

const option = (name: string): HTMLElement => screen.getByRole("button", { name });

describe("ApprovalCard", () => {
  it("reads sent once a synchronous submit returns", async () => {
    const onSubmit = vi.fn<Submit>();
    renderCard(onSubmit);
    fireEvent.click(option("Allow"));
    expect(await screen.findByText("Answered")).toBeTruthy();
    expect(onSubmit).toHaveBeenCalledWith([{ optionIds: ["allow"], questionId: "q1" }]);
  });

  it("holds the options while the answer is in flight, hands them back on a refusal, and sends again", async () => {
    const onSubmit = vi
      .fn<Submit>()
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValueOnce();
    renderCard(onSubmit);

    fireEvent.click(option("Deny"));
    expect(option("Allow")).toHaveProperty("disabled", true);
    expect(option("Deny")).toHaveProperty("disabled", true);
    await waitFor(() => {
      expect(option("Deny")).toHaveProperty("disabled", false);
    });
    expect(screen.queryByText("Answered")).toBeNull();

    fireEvent.click(option("Deny"));
    expect(await screen.findByText("Answered")).toBeTruthy();
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});
