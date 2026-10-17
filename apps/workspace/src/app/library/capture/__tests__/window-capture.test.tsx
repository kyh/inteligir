// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { endInternalDrag, startInternalDrag } from "../../drag-store";
import type { CapturePayload } from "../capture-payload";
import { useWindowCapture } from "../window-capture";

afterEach(() => {
  cleanup();
  endInternalDrag();
  vi.useRealTimers();
});

type OnCapture = (payload: CapturePayload, folder: string) => void;

const Harness = ({ enabled, onCapture }: { enabled: boolean; onCapture: OnCapture }) => {
  const { catcherRef, dropInto } = useWindowCapture({
    dirFor: () => "Reading",
    enabled,
    onCapture,
  });
  return (
    <div>
      <button type="button">a card</button>
      <input aria-label="a field" />
      <div data-slate-editor="true" contentEditable suppressContentEditableWarning>
        <p>the editor</p>
      </div>
      <textarea ref={catcherRef} aria-label="catcher" />
      <output>{dropInto ?? "no layer"}</output>
    </div>
  );
};

const mount = (enabled = true) => {
  const onCapture = vi.fn<OnCapture>();
  render(<Harness enabled={enabled} onCapture={onCapture} />);
  return onCapture;
};

// jsdom builds no ClipboardEvent or DragEvent with data, so the data rides the event itself
const strings = (data: Record<string, string>) => ({
  files: [],
  getData: (format: string) => data[format] ?? "",
  items: [],
});

const paste = (target: Element, text: string): Event => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: strings({ "text/plain": text }) });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

const drag = (type: "dragover" | "drop", target: Element, uris: string, text = ""): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { ...strings({ "text/plain": text, "text/uri-list": uris }), dropEffect: "none" },
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

const card = () => screen.getByRole("button", { name: "a card" });

describe("a paste no field claimed", () => {
  it("saves the links it holds into the folder the scope names", () => {
    const onCapture = mount();
    const event = paste(card(), "https://a.example");
    expect(onCapture).toHaveBeenCalledOnce();
    expect(onCapture.mock.calls[0]).toEqual([
      { files: [], refused: [], urls: [{ title: null, url: "https://a.example" }] },
      "Reading",
    ]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("is the field's when a field or the editor has the focus", () => {
    const onCapture = mount();
    expect(paste(screen.getByLabelText("a field"), "https://a.example").defaultPrevented).toBe(
      false,
    );
    expect(paste(screen.getByText("the editor"), "https://a.example").defaultPrevented).toBe(false);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("leaves a paste that holds nothing to save alone", () => {
    const onCapture = mount();
    expect(paste(card(), "just some words").defaultPrevented).toBe(false);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("takes nothing while another surface covers the window", () => {
    const onCapture = mount(false);
    paste(card(), "https://a.example");
    expect(onCapture).not.toHaveBeenCalled();
  });
});

describe("⌘V where nothing takes text", () => {
  it("moves the focus to the catcher, whose paste is saved and the focus handed back", () => {
    const onCapture = mount();
    card().focus();
    fireEvent.keyDown(card(), { key: "v", metaKey: true });
    const catcher = screen.getByLabelText("catcher");
    expect(document.activeElement).toBe(catcher);
    const event = paste(catcher, "https://a.example");
    expect(event.defaultPrevented).toBe(true);
    expect(onCapture).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(card());
  });

  it("leaves the focus in a field the user is typing in", () => {
    mount();
    const field = screen.getByLabelText("a field");
    field.focus();
    fireEvent.keyDown(field, { key: "v", metaKey: true });
    expect(document.activeElement).toBe(field);
  });

  it("lets the focus go when nothing had it, rather than keep it in the catcher", () => {
    const onCapture = mount();
    fireEvent.keyDown(document.body, { key: "v", metaKey: true });
    const catcher = screen.getByLabelText("catcher");
    expect(document.activeElement).toBe(catcher);
    paste(catcher, "https://a.example");
    expect(onCapture).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(document.body);
  });

  it("lets the focus go when the ⌘V makes no paste at all", () => {
    vi.useFakeTimers();
    mount();
    card().focus();
    fireEvent.keyDown(card(), { key: "v", metaKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText("catcher"));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(document.activeElement).toBe(card());
  });

  it("keeps nothing in the catcher when the paste held no link", () => {
    const onCapture = mount();
    card().focus();
    fireEvent.keyDown(card(), { key: "v", metaKey: true });
    const catcher = screen.getByLabelText("catcher");
    expect(paste(catcher, "words").defaultPrevented).toBe(true);
    expect(onCapture).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(card());
  });
});

describe("a drop over the window", () => {
  it("draws the layer naming the folder while a drag is held over, and saves the drop", () => {
    vi.useFakeTimers();
    const onCapture = mount();
    expect(drag("dragover", card(), "https://a.example").defaultPrevented).toBe(true);
    expect(screen.getByRole("status", { hidden: true }).textContent).toBe("Reading");
    drag("drop", card(), "https://a.example");
    expect(screen.getByRole("status", { hidden: true }).textContent).toBe("no layer");
    expect(onCapture).toHaveBeenCalledOnce();
  });

  it("lets the layer go once the drag stops hovering", () => {
    vi.useFakeTimers();
    mount();
    drag("dragover", card(), "https://a.example");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole("status", { hidden: true }).textContent).toBe("no layer");
  });

  it("is a move, never a save, while the window drags its own cards", () => {
    const onCapture = mount();
    startInternalDrag(["Reading/a.md"]);
    expect(drag("dragover", card(), "https://a.example").defaultPrevented).toBe(false);
    drag("drop", card(), "https://a.example");
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("never saves a drag that started inside the page, such as a picture in the viewer", () => {
    const onCapture = mount();
    act(() => {
      card().dispatchEvent(new Event("dragstart", { bubbles: true }));
    });
    expect(drag("dragover", card(), "http://127.0.0.1:4664/vault/asset?m=t").defaultPrevented).toBe(
      false,
    );
    drag("drop", card(), "http://127.0.0.1:4664/vault/asset?m=t");
    expect(onCapture).not.toHaveBeenCalled();
    // once that drag ends, a drop from outside the window is saved again
    act(() => {
      card().dispatchEvent(new Event("dragend", { bubbles: true }));
    });
    drag("drop", card(), "https://a.example");
    expect(onCapture).toHaveBeenCalledOnce();
  });

  it("leaves a drop on a field to the field", () => {
    const onCapture = mount();
    const field = screen.getByLabelText("a field");
    expect(drag("dragover", field, "https://a.example").defaultPrevented).toBe(false);
    expect(drag("drop", field, "https://a.example").defaultPrevented).toBe(false);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("leaves a drop that holds nothing to save to the browser", () => {
    const onCapture = mount();
    expect(drag("drop", card(), "", "a sentence from the note").defaultPrevented).toBe(false);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("leaves a drop the editor or a row already took", () => {
    const onCapture = mount();
    drag("drop", screen.getByText("the editor"), "https://a.example");
    const taken = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(taken, "dataTransfer", {
      value: strings({ "text/uri-list": "https://a.example" }),
    });
    taken.preventDefault();
    act(() => {
      card().dispatchEvent(taken);
    });
    expect(onCapture).not.toHaveBeenCalled();
  });
});
