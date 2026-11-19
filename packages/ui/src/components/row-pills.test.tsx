import { act, fireEvent, render, screen } from "@testing-library/react";
import { Activity, Profiler, useState } from "react";
import type { ProfilerOnRenderCallback } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rowBox } from "../lib/row-box";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from "./sidebar-menu";

const ROW_HEIGHT = 28;
const ROW_WIDTH = 200;
const ROW = '[data-sidebar="menu-item"], [role^="menuitem"]';
const BOXED = `${ROW}, [data-sidebar="menu-button"]`;

const rowTop = (element: HTMLElement) => {
  const siblings = element.parentElement === null ? [] : [...element.parentElement.children];

  return siblings.filter((sibling) => sibling.matches(ROW)).indexOf(element) * ROW_HEIGHT;
};

const top = (index: number) => `${String(index * ROW_HEIGHT)}px`;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function offsetTop(
    this: HTMLElement,
  ) {
    return this.matches(ROW) ? rowTop(this) : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function offsetHeight(
    this: HTMLElement,
  ) {
    return this.isConnected && this.matches(BOXED) ? ROW_HEIGHT : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function offsetWidth(
    this: HTMLElement,
  ) {
    return this.isConnected && this.matches(BOXED) ? ROW_WIDTH : 0;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const Menu = ({ keys, active }: { keys: readonly string[]; active?: string }) => (
  <SidebarMenu aria-label="Rows">
    {keys.map((key) => (
      <SidebarMenuItem key={key}>
        <SidebarMenuButton isActive={key === active}>{key}</SidebarMenuButton>
      </SidebarMenuItem>
    ))}
  </SidebarMenu>
);

const pillTop = (pill: "active" | "hover") =>
  document.querySelector<HTMLElement>(`.bg-${pill}`)?.style.top ?? null;

const settled = async (check: () => void) => {
  await vi.waitFor(check, { timeout: 5000 });
};

const row = (name: string) => screen.getByRole("button", { name });

const tabStops = (names: readonly string[]) => names.filter((name) => row(name).tabIndex === 0);

const menuIn = (mode: "hidden" | "visible") => (
  <Activity mode={mode}>
    <Menu keys={["a", "b", "c"]} active="c" />
  </Activity>
);

describe("the sidebar's active pill", () => {
  it("is drawn at the current row in the commit that mounts the list", () => {
    render(<Menu keys={["a", "b", "c"]} active="b" />);
    expect(pillTop("active")).toBe(top(1));
  });

  it("moves with a keyed reorder, which mounts no row", async () => {
    const { rerender } = render(<Menu keys={["a", "b", "c"]} active="b" />);
    await act(async () => {
      rerender(<Menu keys={["b", "a", "c"]} active="b" />);
    });
    await settled(() => {
      expect(pillTop("active")).toBe(top(0));
    });
  });

  it("is redrawn where its row went when rows are inserted above it", async () => {
    const { rerender } = render(<Menu keys={["a", "b", "c"]} active="c" />);
    expect(pillTop("active")).toBe(top(2));
    await act(async () => {
      rerender(<Menu keys={["x", "y", "a", "b", "c"]} active="c" />);
    });
    await settled(() => {
      expect(pillTop("active")).toBe(top(4));
    });
  });

  it("is drawn when a list mounted hidden is shown", () => {
    const { rerender } = render(menuIn("hidden"));
    expect(pillTop("active")).toBeNull();
    rerender(menuIn("visible"));
    expect(pillTop("active")).toBe(top(2));
  });
});

const OwnRow = ({ name }: { name: string }) => {
  const [current, setCurrent] = useState(false);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={current}
        onClick={() => {
          setCurrent(true);
        }}
      >
        {name}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
};

const MenuWithActions = ({ keys, active }: { keys: readonly string[]; active?: string }) => (
  <SidebarMenu aria-label="Rows">
    {keys.map((key) => (
      <SidebarMenuItem key={key}>
        <SidebarMenuButton isActive={key === active}>{key}</SidebarMenuButton>
        <SidebarMenuAction aria-label={`More for ${key}`} />
      </SidebarMenuItem>
    ))}
  </SidebarMenu>
);

const litRows = (names: readonly string[]) =>
  names.filter((name) => row(name).closest("li")?.dataset.lit === "");

describe("the sidebar's tab stop", () => {
  it("takes the current row's action with it, and no other row's", async () => {
    const { rerender } = render(<MenuWithActions keys={["a", "b", "c"]} active="b" />);
    const actions = ["More for a", "More for b", "More for c"];
    expect(tabStops(actions)).toStrictEqual(["More for b"]);

    await act(async () => {
      rerender(<MenuWithActions keys={["a", "b", "c"]} />);
    });
    expect(tabStops(actions)).toStrictEqual(["More for a"]);
  });

  it("is the current row, else the list's first", async () => {
    const { rerender } = render(<Menu keys={["a", "b", "c"]} active="b" />);
    expect(tabStops(["a", "b", "c"])).toStrictEqual(["b"]);

    await act(async () => {
      rerender(<Menu keys={["a", "b", "c"]} />);
    });
    expect(tabStops(["a", "b", "c"])).toStrictEqual(["a"]);

    await act(async () => {
      rerender(<Menu keys={["x", "a", "b", "c"]} />);
    });
    expect(tabStops(["x", "a", "b", "c"])).toStrictEqual(["x"]);
  });

  it("follows a row that turns current with no render of the list", async () => {
    render(
      <SidebarMenu aria-label="Rows">
        <OwnRow name="a" />
        <OwnRow name="b" />
      </SidebarMenu>,
    );
    expect(tabStops(["a", "b"])).toStrictEqual(["a"]);

    await act(async () => {
      fireEvent.click(row("b"));
    });
    expect(tabStops(["a", "b"])).toStrictEqual(["b"]);
    expect(pillTop("active")).toBe(top(1));
  });
});

describe("the sidebar's hover pill", () => {
  it("sits on the row under the pointer and goes when the pointer leaves the list", async () => {
    render(<Menu keys={["a", "b", "c"]} />);
    fireEvent.mouseMove(row("c"));
    expect(pillTop("hover")).toBe(top(2));

    fireEvent.mouseLeave(screen.getByRole("list"));
    await settled(() => {
      expect(pillTop("hover")).toBeNull();
    });
  });

  it("sits on the row focus reaches, never on a row whose action took it", async () => {
    render(
      <SidebarMenu aria-label="Rows">
        <SidebarMenuItem>
          <SidebarMenuButton>a</SidebarMenuButton>
          <SidebarMenuAction aria-label="More" />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton>b</SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>,
    );
    act(() => {
      row("b").focus();
    });
    expect(pillTop("hover")).toBe(top(1));

    act(() => {
      row("More").focus();
    });
    expect(pillTop("hover")).toBe(top(1));

    act(() => {
      row("More").blur();
    });
    await settled(() => {
      expect(pillTop("hover")).toBeNull();
    });
  });

  it("marks the row it sits on lit, and only that row, when focus moves it off the pointer's", async () => {
    render(<Menu keys={["a", "b", "c"]} />);
    fireEvent.mouseMove(row("a"));
    expect(litRows(["a", "b", "c"])).toStrictEqual(["a"]);

    act(() => {
      row("c").focus();
    });
    expect(litRows(["a", "b", "c"])).toStrictEqual(["c"]);
    await settled(() => {
      expect(pillTop("hover")).toBe(top(2));
    });
  });

  it("re-renders no row as it travels", () => {
    const keys = Array.from({ length: 20 }, (_, index) => `row${String(index)}`);
    const rendered: string[] = [];

    const onRender: ProfilerOnRenderCallback = (id) => {
      rendered.push(id);
    };

    render(
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
    fireEvent.mouseMove(row("row3"));
    rendered.length = 0;
    fireEvent.mouseMove(row("row4"));
    expect(pillTop("hover")).not.toBeNull();
    expect(rendered).toStrictEqual([]);
  });
});

const menuRows = (
  <DropdownMenu open>
    <DropdownMenuTrigger>Sort</DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem>Refresh</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem>Rename</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

const openMenu = async () => {
  render(menuRows);
  await settled(() => {
    expect(document.activeElement).toBe(screen.getByRole("menu"));
  });
};

describe("a dropdown's pill", () => {
  it("lights the row Base UI highlights, and none while the pointer is over a separator", async () => {
    await openMenu();
    const rename = screen.getByRole("menuitem", { name: "Rename" });
    fireEvent.mouseMove(rename);
    expect(rename.dataset.highlighted).toBe("");
    await settled(() => {
      expect(pillTop("hover")).toBe(top(1));
    });

    fireEvent.pointerLeave(rename, { relatedTarget: screen.getByRole("separator") });
    expect(rename.dataset.highlighted).toBeUndefined();
    await settled(() => {
      expect(pillTop("hover")).toBeNull();
    });
  });

  it("follows the arrow keys", async () => {
    await openMenu();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    await settled(() => {
      expect(pillTop("hover")).toBe(top(0));
    });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Refresh" }), { key: "ArrowDown" });
    await settled(() => {
      expect(pillTop("hover")).toBe(top(1));
    });
  });
});

describe("a dropdown's radio rows", () => {
  it("hand a pick back as the row's value", () => {
    const onValueChange = vi.fn<(value: string) => void>();
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Sort</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="name" onValueChange={onValueChange}>
            <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="modified">Modified</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByRole("menuitemradio", { name: "Name" }).getAttribute("aria-checked")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Modified" }));
    expect(onValueChange.mock.lastCall?.[0]).toBe("modified");
  });
});

const listRows = () => {
  const [first, second] = screen.getAllByRole("listitem");

  if (first === undefined || second === undefined) {
    throw new Error("the menu did not render two rows");
  }

  return [first, second] satisfies [HTMLElement, HTMLElement];
};

describe("a row's box", () => {
  it("travels to another row, and is placed at once where its own row moved", () => {
    render(<Menu keys={["a", "b"]} />);
    const [first, second] = listRows();
    const box = rowBox(first, null);
    expect(box?.travels).toBe(true);
    expect(rowBox(first, box)).toBe(box);
    expect(rowBox(second, box)?.travels).toBe(true);

    first.before(second);
    const moved = rowBox(first, box);
    expect(moved?.rect.top).toBe(ROW_HEIGHT);
    expect(moved?.travels).toBe(false);
  });

  it("is nothing for a row out of the document", () => {
    const { unmount } = render(<Menu keys={["a", "b"]} />);
    const [first] = listRows();
    unmount();
    expect(rowBox(first, null)).toBeNull();
  });
});
