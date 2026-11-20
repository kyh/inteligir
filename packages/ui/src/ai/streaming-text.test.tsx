import { render, screen } from "@testing-library/react";
import { Profiler } from "react";
import type { ProfilerOnRenderCallback } from "react";
import { describe, expect, it, vi } from "vitest";

import { StreamingText } from "./streaming-text";

describe(StreamingText, () => {
  it("commits a text change once when the caller grows the text itself", () => {
    const onRender = vi.fn<ProfilerOnRenderCallback>();

    const view = (text: string) => (
      <Profiler id="streaming-text" onRender={onRender}>
        <StreamingText text={text} />
      </Profiler>
    );

    const { rerender } = render(view("Reading the"));
    onRender.mockClear();

    rerender(view("Reading the note"));
    expect(onRender).toHaveBeenCalledOnce();
    expect(screen.getByText("Reading the note")).toBeTruthy();
  });
});
