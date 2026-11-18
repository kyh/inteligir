"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import { Fragment, createContext, useContext, useId, useLayoutEffect, useState } from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  LiHTMLAttributes,
  ReactNode,
  RefAttributes,
} from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@repo/ui/lib/cn";
import { fontWeights } from "@repo/ui/lib/font-weight";
import { radius } from "@repo/ui/lib/radius";
import { RowPills } from "@repo/ui/components/row-pills";
import { useLayoutReading } from "@repo/ui/hooks/use-layout-reading";
import type { IconComponent } from "@repo/ui/lib/icon";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { rowBox } from "@repo/ui/lib/row-box";
import type { ItemRect, RowBox } from "@repo/ui/lib/row-box";
import { splitLeadingText } from "@repo/ui/lib/text-children";

// the row id of the button Tab lands on: the current row's, else the list's first
const TabStopContext = createContext<string | null>(null);
// a row's id, which its button and its action find the list's tab stop by
const RowContext = createContext<string | null>(null);

const useHoldsTabStop = (): boolean => {
  const rowId = useContext(RowContext);
  const tabStop = useContext(TabStopContext);
  return rowId !== null && tabStop === rowId;
};

const MENU_ITEM = '[data-sidebar="menu-item"]';
const MENU_BUTTON = '[data-sidebar="menu-button"]';

// A row's box spans the whole <li>, so it is clamped to the button's; 32px is the tallest row,
// for a row whose button is not its direct child.
const measureRow = (row: HTMLElement): ItemRect => {
  const button = row.querySelector<HTMLElement>(`:scope > ${MENU_BUTTON}`);
  return {
    height: Math.min(row.offsetHeight, button?.offsetHeight ?? 32),
    left: row.offsetLeft,
    top: row.offsetTop,
    width: row.offsetWidth,
  };
};

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"]);

// What the list reads off its rows: where each pill sits, and which button Tab lands on.
interface MenuReading {
  active: RowBox | null;
  focus: RowBox | null;
  hover: RowBox | null;
  tabStop: string | null;
}

const UNREAD: MenuReading = { active: null, focus: null, hover: null, tabStop: null };

// a row that turns current with no render of its list says so by this attribute alone
const MARKS = ["aria-current"];

// The row under the hover pill carries this attribute, which its tone and its action read. The
// list writes it to the row's element, so the pill's travel re-renders no row.
const LIT = "data-lit";

const onKeyDown = (e: React.KeyboardEvent) => {
  // a row that walked the key itself (a tree's expand on ArrowRight) is left alone
  if (!NAV_KEYS.has(e.key) || e.defaultPrevented || !(e.target instanceof HTMLElement)) {
    return;
  }
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(MENU_BUTTON)];
  const currentIdx = items.indexOf(e.target);
  if (currentIdx === -1) {
    return;
  }
  e.preventDefault();
  // keep handled arrows from the shell's window-level key bindings
  e.stopPropagation();
  if (e.key === "Home") {
    items[0]?.focus();
  } else if (e.key === "End") {
    items.at(-1)?.focus();
  } else {
    const forward = e.key === "ArrowDown" || e.key === "ArrowRight";
    const next = forward
      ? (currentIdx + 1) % items.length
      : (currentIdx - 1 + items.length) % items.length;
    items[next]?.focus();
  }
};

interface MenuScope {
  tabStop: string | null;
  containerProps: {
    onMouseEnter: () => void;
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseLeave: () => void;
    onFocus: (e: React.FocusEvent) => void;
    onBlur: (e: React.FocusEvent) => void;
    onPointerDown: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
  };
  pills: ReactNode;
}

// A row is a plain element: the list finds the lit one from where the pointer and focus are, and
// the current one by its aria-current.
const useMenuScope = (list: HTMLElement | null): MenuScope => {
  // the row under the hover pill: the pointer's, or the one focus reached since
  const [lit, setLit] = useState<HTMLElement | null>(null);
  const [focused, setFocused] = useState<HTMLElement | null>(null);
  const [session, setSession] = useState(0);

  useLayoutEffect(() => {
    if (lit === null) {
      return;
    }
    lit.setAttribute(LIT, "");
    return () => {
      lit.removeAttribute(LIT);
    };
  }, [lit]);

  const reading = useLayoutReading(
    list,
    UNREAD,
    (container, last) => {
      // the first current button in document order carries the active pill
      const current = container.querySelector<HTMLElement>(`${MENU_BUTTON}[aria-current="page"]`);
      const stop = current ?? container.querySelector<HTMLElement>(MENU_BUTTON);
      const next: MenuReading = {
        active: rowBox(current?.closest<HTMLElement>(MENU_ITEM) ?? null, last.active, measureRow),
        focus: rowBox(focused, last.focus, measureRow),
        hover: rowBox(lit, last.hover, measureRow),
        tabStop: stop?.dataset.row ?? null,
      };
      return next.active === last.active &&
        next.focus === last.focus &&
        next.hover === last.hover &&
        next.tabStop === last.tabStop
        ? last
        : next;
    },
    MARKS,
  );

  // found from the event's own target, so a move inside a popup a row opened lights no row
  const onMouseMove = (e: React.MouseEvent) => {
    const row = e.target instanceof Element ? e.target.closest<HTMLElement>(MENU_ITEM) : null;
    if (row !== null) {
      setLit(row);
    }
  };

  const onFocus = (e: React.FocusEvent) => {
    // a row's action button takes focus without lighting its row
    const row = e.target.closest(MENU_BUTTON)?.closest<HTMLElement>(MENU_ITEM) ?? null;
    if (row === null) {
      return;
    }
    setLit(row);
    setFocused(e.target.matches(":focus-visible") ? row : null);
  };

  const onBlur = (e: React.FocusEvent) => {
    if (e.currentTarget.contains(e.relatedTarget)) {
      return;
    }
    setFocused(null);
    // a row's menu takes focus as it opens with the pointer still on the row
    setLit(e.currentTarget.querySelector<HTMLElement>(`${MENU_ITEM}:hover`));
  };

  return {
    containerProps: {
      onBlur,
      onFocus,
      onKeyDown,
      onMouseEnter: () => {
        setSession((entered) => entered + 1);
      },
      // the pill goes back to the row the keyboard holds, if any
      onMouseLeave: () => {
        setLit(focused);
      },
      onMouseMove,
      // clicking the already-focused row never re-fires focus, so without this the keyboard ring
      // would stick until focus left the menu
      onPointerDown: () => {
        setFocused(null);
      },
    },
    pills: (
      <RowPills
        active={reading.active}
        hover={reading.hover}
        focus={reading.focus}
        session={session}
      />
    ),
    tabStop: reading.tabStop,
  };
};

type SidebarMenuProps = LiHTMLAttributes<HTMLUListElement>;

// One scope per list: a single traveling hover, active and focus pill over every row.
const SidebarMenu = ({
  className,
  children,
  ref,
  ...props
}: SidebarMenuProps & RefAttributes<HTMLUListElement>) => {
  const [list, setList] = useState<HTMLUListElement | null>(null);
  const { tabStop, containerProps, pills } = useMenuScope(list);

  return (
    <TabStopContext value={tabStop}>
      <ul
        ref={composeRefs(setList, ref)}
        data-sidebar="menu"
        className={cn("relative flex w-full min-w-0 flex-col gap-0.5 select-none", className)}
        {...containerProps}
        {...props}
      >
        {pills}
        {children}
      </ul>
    </TabStopContext>
  );
};

type SidebarMenuItemProps = LiHTMLAttributes<HTMLLIElement>;

// The pseudo-element closes the 2px gap to the next row, so the pointer leaves one row's hover
// straight into its neighbour's.
const SidebarMenuItem = ({
  className,
  ref,
  ...props
}: SidebarMenuItemProps & RefAttributes<HTMLLIElement>) => {
  const rowId = useId();
  return (
    <RowContext value={rowId}>
      <li
        ref={ref}
        data-sidebar="menu-item"
        className={cn(
          "group/menu-item relative before:absolute before:inset-x-0 before:-inset-y-px",
          className,
        )}
        {...props}
      />
    </RowContext>
  );
};

// A row reads lit where the hover pill is, which the pointer or the keyboard put there; the current
// row is lit for good.
const LIT_TONE = "text-muted-foreground group-data-lit/menu-item:text-foreground";
const LIT_STROKE = "group-data-lit/menu-item:stroke-2";

// element children render outside the text-box-trimmed span, which would clip an inline SVG
const MenuRowLabel = ({
  content,
  emphasized,
  textClass,
}: {
  content: ReactNode;
  emphasized: boolean;
  textClass: string;
}) => {
  const { text, rest } = splitLeadingText(content);
  const tone = emphasized ? "text-foreground" : LIT_TONE;

  if (!text) {
    return (
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 transition-colors duration-80",
          tone,
          textClass,
        )}
      >
        {content}
      </span>
    );
  }

  // the trim box spans cap height to baseline, so the overflow clip would shave ascenders and
  // descenders; symmetric padding extends the clip box and the negative margins cancel it out of
  // the row's height
  return (
    <>
      <span className={cn("inline-grid min-w-0 text-left", textClass)}>
        <span
          className="invisible col-start-1 row-start-1 -mt-[0.25em] -mb-[0.25em] truncate pt-[0.25em] pb-[0.25em] [text-box:trim-both_cap_alphabetic]"
          style={{ fontVariationSettings: fontWeights.semibold }}
          aria-hidden="true"
        >
          {text}
        </span>
        <span
          className={cn(
            "col-start-1 row-start-1 -mt-[0.25em] -mb-[0.25em] truncate pt-[0.25em] pb-[0.25em] transition-[color,font-variation-settings] duration-80 [text-box:trim-both_cap_alphabetic]",
            tone,
          )}
          style={{
            fontVariationSettings: emphasized ? fontWeights.semibold : fontWeights.normal,
          }}
        >
          {text}
        </span>
      </span>
      {rest.map((node, i) => (
        <Fragment key={i}>{node}</Fragment>
      ))}
    </>
  );
};

type SidebarMenuButtonProps = useRender.ComponentProps<"button"> & {
  isActive?: boolean;
  icon?: IconComponent;
};

// The row: leading text is the label, drawn semibold while active without the row widening;
// anything after it lands at the trailing edge as given. A button, or what `render` makes it, such
// as a link to the row's place.
const SidebarMenuButton = ({
  isActive = false,
  icon: Icon,
  className,
  children,
  render,
  ref,
  ...props
}: SidebarMenuButtonProps) => {
  const rowId = useContext(RowContext);
  const holdsTabStop = useHoldsTabStop();

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        "aria-current": isActive ? "page" : undefined,
        children: (
          <>
            {Icon ? (
              <Icon
                size={14}
                strokeWidth={1.5}
                className={cn(
                  "shrink-0 transition-[color,stroke-width] duration-80",
                  isActive ? "stroke-2 text-foreground" : `${LIT_STROKE} ${LIT_TONE}`,
                )}
              />
            ) : null}
            <MenuRowLabel content={children} emphasized={isActive} textClass="text-body" />
          </>
        ),
        className: cn(
          "peer/menu-button relative z-10 flex h-7 w-full cursor-pointer items-center gap-2 px-2 text-left outline-none select-none",
          radius.item,
          className,
        ),
        tabIndex: isActive || holdsTabStop ? 0 : -1,
        type: render === undefined ? "button" : undefined,
      },
      props,
    ),
    ref,
    render,
    state: { active: isActive, row: rowId, sidebar: "menu-button" },
  });
};

// A 24px button over the row's trailing edge, a sibling of the row button rather than a child,
// since a button cannot nest a button. It shows while its row is lit, while it holds the keyboard's
// focus and while its popup is open, and the row's badge gives it the edge then.
const SidebarMenuAction = ({
  className,
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & RefAttributes<HTMLButtonElement>) => {
  // one Tab stop per row, so Tab leaves the list after the current row and its action; set over
  // the props, since a menu trigger rendering the action hands it a tabIndex of 0
  const tabIndex = useHoldsTabStop() ? 0 : -1;
  return (
    <button
      ref={ref}
      type="button"
      data-sidebar="menu-action"
      className={cn(
        "absolute top-1/2 right-1 z-20 flex size-6 shrink-0 -translate-y-1/2 items-center justify-center text-muted-foreground outline-none",
        "transition-[color,opacity] duration-80 hover:text-foreground focus-visible:text-foreground",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "opacity-0 group-data-lit/menu-item:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100",
        radius.item,
        className,
      )}
      {...props}
      tabIndex={tabIndex}
    />
  );
};

// when the row's action shows, in a row that has one
const YIELDS_TO_ACTION = [
  "group-has-data-[sidebar=menu-action]/menu-item:group-data-lit/menu-item:opacity-0",
  "group-has-[[data-sidebar=menu-action]:focus-visible]/menu-item:opacity-0",
  "group-has-[[data-sidebar=menu-action][data-popup-open]]/menu-item:opacity-0",
].join(" ");

// A row's count, at its trailing edge. It gives the edge to the row's action while that shows, so
// the two never overlap and every list's counts keep one column.
const SidebarMenuBadge = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLSpanElement> & RefAttributes<HTMLSpanElement>) => (
  <span
    ref={ref}
    data-sidebar="menu-badge"
    className={cn(
      "ml-auto shrink-0 text-caption text-muted-foreground tabular-nums transition-opacity duration-80",
      YIELDS_TO_ACTION,
      className,
    )}
    {...props}
  />
);

export { SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuAction, SidebarMenuBadge };
