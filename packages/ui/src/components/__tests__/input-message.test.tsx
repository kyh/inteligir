// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InputMessage } from "../input-message";

/* oxlint-disable class-methods-use-this -- the observer's instance API: `new ResizeObserver()` reaches these on the instance, never as statics */
class ResizeObserverStub {
  observe = (): void => {};
  unobserve = (): void => {};
  disconnect = (): void => {};
}
/* oxlint-enable class-methods-use-this */

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderField = () => {
  const onSend = vi.fn<(value: string) => void>();
  render(<InputMessage value="日本語" onValueChange={() => {}} onSend={onSend} />);
  return { field: screen.getByRole("textbox", { name: "Message" }), onSend };
};

describe("an Enter in the message field", () => {
  it("sends the message", () => {
    const { field, onSend } = renderField();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).toHaveBeenCalledExactlyOnceWith("日本語");
  });

  it("commits an IME candidate instead, while composing", () => {
    const { field, onSend } = renderField();
    fireEvent.keyDown(field, { isComposing: true, key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("commits an IME candidate instead when Safari reports it after compositionend", () => {
    const { field, onSend } = renderField();
    fireEvent.keyDown(field, { isComposing: false, key: "Enter", keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
  });
});
