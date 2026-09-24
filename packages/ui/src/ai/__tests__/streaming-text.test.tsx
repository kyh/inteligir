// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import type { ProfilerOnRenderCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StreamingText } from "../streaming-text";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("StreamingText", () => {
  it("commits a text change once when the caller grows the text itself", () => {
    const onRender = vi.fn<ProfilerOnRenderCallback>();
    const view = (text: string) => (
      <Profiler id="streaming-text" onRender={onRender}>
        <StreamingText text={text} animate={false} />
      </Profiler>
    );
    const { rerender } = render(view("Reading the"));
    onRender.mockClear();

    rerender(view("Reading the note"));
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Reading the note")).toBeTruthy();
  });

  it("stops its reveal timer once every word is shown", () => {
    vi.useFakeTimers();
    render(<StreamingText text="one two three" />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("one two three")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
