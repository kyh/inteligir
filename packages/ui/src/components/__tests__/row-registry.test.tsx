// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Activity, Profiler } from "react";
import type { ProfilerOnRenderCallback, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandDialog, CommandItem, CommandList } from "../command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../sidebar-menu";

// jsdom lays nothing out, so a row is given the box a list of equal rows would give it: one row
// tall, at its index among its sibling rows. The container keeps a zero box, which leaves the
// proximity pick unscaled.
const ROW_HEIGHT = 28;
const ROW_WIDTH = 200;
const ROW = '[data-sidebar="menu-item"], [data-dropdown-menu-item], [data-command-item]';
const BOXED = `${ROW}, [data-sidebar="menu-button"]`;

const rowTop = (element: HTMLElement): number => {
  const siblings = element.parentElement === null ? [] : [...element.parentElement.children];
  return siblings.filter((sibling) => sibling.matches(ROW)).indexOf(element) * ROW_HEIGHT;
};

// every frame the lists ask for, run by hand so a test can look between a commit and its measure
let frames = new Map<number, FrameRequestCallback>();
let lastFrame = 0;
let framesRequested = 0;

const runFrames = (): void => {
  act(() => {
    const due = [...frames.values()];
    frames = new Map();
    for (const frame of due) {
      frame(0);
    }
  });
};

// every observer the lists build: each observe is one row registered
let observers: CountingResizeObserver[] = [];

class CountingResizeObserver {
  readonly watched = new Set<Element>();
  observeCalls = 0;

  constructor() {
    observers.push(this);
  }

  observe(target: Element): void {
    this.observeCalls += 1;
    this.watched.add(target);
  }

  unobserve(target: Element): void {
    this.watched.delete(target);
  }

  disconnect(): void {
    this.watched.clear();
  }
}

const observeCalls = (): number =>
  observers.reduce((total, observer) => total + observer.observeCalls, 0);

const observedRows = (): number =>
  observers.flatMap((observer) => [...observer.watched]).filter((element) => element.matches(ROW))
    .length;

beforeEach(() => {
  frames = new Map();
  lastFrame = 0;
  framesRequested = 0;
  observers = [];
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback): number => {
    framesRequested += 1;
    lastFrame += 1;
    frames.set(lastFrame, frame);
    return lastFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
    frames.delete(id);
  });
  vi.stubGlobal("ResizeObserver", CountingResizeObserver);
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function offsetTop(
    this: HTMLElement,
  ) {
    return this.matches(ROW) ? rowTop(this) : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function offsetHeight(
    this: HTMLElement,
  ) {
    return this.matches(BOXED) ? ROW_HEIGHT : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function offsetWidth(
    this: HTMLElement,
  ) {
    return this.matches(BOXED) ? ROW_WIDTH : 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const keysFrom = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index)}`);

const Menu = ({ keys, active }: { keys: readonly string[]; active?: string }) => (
  <SidebarMenu aria-label="Rows">
    {keys.map((key) => (
      <SidebarMenuItem key={key}>
        <SidebarMenuButton isActive={key === active}>{key}</SidebarMenuButton>
      </SidebarMenuItem>
    ))}
  </SidebarMenu>
);

const menuList = (container: HTMLElement): HTMLElement => {
  const list = container.querySelector<HTMLElement>('[data-sidebar="menu"]');
  if (list === null) {
    throw new Error("the menu did not render its list");
  }
  return list;
};

// null while the list is between a commit that moved its rows and the measure after it
const activePillTop = (list: HTMLElement): string | null =>
  list.querySelector<HTMLElement>(".bg-active")?.style.top ?? null;

interface MountCost {
  frames: number;
  observes: number;
}

const mountCost = (draw: (keys: readonly string[]) => ReactNode, count: number) => {
  const before: MountCost = { frames: framesRequested, observes: observeCalls() };
  const view = render(draw(keysFrom("row", count)));
  const cost: MountCost = {
    frames: framesRequested - before.frames,
    observes: observeCalls() - before.observes,
  };
  view.unmount();
  return cost;
};

// Mounting a list registers every row once and measures once, whatever its length; a sync per
// row would re-register every row for every row.
const expectLinearMount = (draw: (keys: readonly string[]) => ReactNode): void => {
  const small = mountCost(draw, 10);
  const large = mountCost(draw, 1000);
  // at most, not equal: a popup's first mount in the file may ask a frame of its own
  expect(large.frames).toBeLessThanOrEqual(small.frames);
  expect(large.observes - small.observes).toBe(990);
};

describe("a list's rows register in one pass per commit", () => {
  it("mounts a sidebar menu of a thousand rows with one measure", () => {
    expectLinearMount((keys) => <Menu keys={keys} />);
  });

  it("mounts a command list of a thousand rows with one measure", () => {
    expectLinearMount((keys) => (
      <CommandDialog open onOpenChange={vi.fn()} title="Rows" description="A long list">
        <CommandList>
          {keys.map((key) => (
            <CommandItem key={key}>{key}</CommandItem>
          ))}
        </CommandList>
      </CommandDialog>
    ));
  });

  it("mounts a dropdown of a thousand rows with one measure", () => {
    expectLinearMount((keys) => (
      <DropdownMenu open>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          {keys.map((key) => (
            <DropdownMenuItem key={key}>{key}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ));
  });

  it("inserts rows above a long list and removes them all without a pass per row", () => {
    const below = keysFrom("below", 500);
    const { rerender } = render(<Menu keys={below} />);

    const insertCost = (count: number): MountCost => {
      const before: MountCost = { frames: framesRequested, observes: observeCalls() };
      rerender(<Menu keys={[...keysFrom(`above${String(count)}-`, count), ...below]} />);
      const cost = {
        frames: framesRequested - before.frames,
        observes: observeCalls() - before.observes,
      };
      rerender(<Menu keys={below} />);
      return cost;
    };
    const few = insertCost(5);
    const many = insertCost(500);
    expect(many.frames).toBe(few.frames);
    expect(many.observes - few.observes).toBe(495);

    const framesBefore = framesRequested;
    rerender(<Menu keys={[]} />);
    expect(framesRequested - framesBefore).toBe(few.frames);
    expect(observedRows()).toBe(0);
  });
});

describe("the active pill follows its row", () => {
  it("moves with a keyed reorder, which mounts no row", async () => {
    const { container, rerender } = render(<Menu keys={["a", "b", "c"]} active="b" />);
    runFrames();
    const list = menuList(container);
    expect(activePillTop(list)).toBe(`${String(ROW_HEIGHT)}px`);

    await act(async () => {
      rerender(<Menu keys={["b", "a", "c"]} active="b" />);
    });
    runFrames();
    expect(activePillTop(list)).toBe("0px");
  });

  it("is hidden, not drawn at the old rect, in the commit that inserts rows above it", () => {
    const { container, rerender } = render(<Menu keys={["a", "b", "c"]} active="c" />);
    runFrames();
    const list = menuList(container);
    expect(activePillTop(list)).toBe(`${String(2 * ROW_HEIGHT)}px`);

    rerender(<Menu keys={["x", "y", "a", "b", "c"]} active="c" />);
    expect(activePillTop(list)).toBeNull();
    runFrames();
    expect(activePillTop(list)).toBe(`${String(4 * ROW_HEIGHT)}px`);
  });
});

const menuIn = (mode: "hidden" | "visible") => (
  <Activity mode={mode}>
    <Menu keys={["a", "b", "c"]} active="c" />
  </Activity>
);

describe("a list hidden and shown again", () => {
  it("observes and measures its rows again", () => {
    const { container, rerender } = render(menuIn("visible"));
    runFrames();
    rerender(menuIn("hidden"));
    rerender(menuIn("visible"));
    expect(observedRows()).toBe(3);
    runFrames();
    expect(activePillTop(menuList(container))).toBe(`${String(2 * ROW_HEIGHT)}px`);
  });
});

describe("the hover pill", () => {
  it("re-renders the row it left and the row it reached, and no other", () => {
    const keys = keysFrom("row", 20);
    const rendered: string[] = [];
    const onRender: ProfilerOnRenderCallback = (id) => {
      rendered.push(id);
    };
    const { container } = render(
      <SidebarMenu aria-label="Rows">
        {keys.map((key) => (
          <Profiler key={key} id={key} onRender={onRender}>
            <SidebarMenuItem>
              <SidebarMenuButton>{key}</SidebarMenuButton>
            </SidebarMenuItem>
          </Profiler>
        ))}
      </SidebarMenu>,
    );
    runFrames();
    const list = menuList(container);
    const hoverRow = (index: number): void => {
      fireEvent.mouseMove(list, { clientY: index * ROW_HEIGHT + ROW_HEIGHT / 2 });
      runFrames();
    };

    fireEvent.mouseEnter(list);
    hoverRow(3);
    rendered.length = 0;
    hoverRow(4);
    expect(new Set(rendered)).toEqual(new Set(["row3", "row4"]));
  });
});
