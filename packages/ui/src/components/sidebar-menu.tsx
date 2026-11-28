"use client";
// @license MIT, vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism).

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

const TabStopContext = createContext<string | null>(null);
const RowContext = createContext<string | null>(null);

const useHoldsTabStop = () => {
  const rowId = useContext(RowContext);
  const tabStop = useContext(TabStopContext);

  return rowId !== null && tabStop === rowId;
};

const MENU_ITEM = '[data-sidebar="menu-item"]';
const MENU_BUTTON = '[data-sidebar="menu-button"]';

const measureRow = (row: HTMLElement) => {
  const button = row.querySelector<HTMLElement>(`:scope > ${MENU_BUTTON}`);

  return {
    height: Math.min(row.offsetHeight, button?.offsetHeight ?? 32),
    left: row.offsetLeft,
    top: row.offsetTop,
    width: row.offsetWidth,
  } satisfies ItemRect;
};

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"]);

interface MenuReading {
  active: RowBox | null;
  focus: RowBox | null;
  hover: RowBox | null;
  tabStop: string | null;
}

const UNREAD: MenuReading = { active: null, focus: null, hover: null, tabStop: null };

const MARKS = ["aria-current"];

const LIT = "data-lit";

const onKeyDown = (e: React.KeyboardEvent) => {
  if (!NAV_KEYS.has(e.key) || e.defaultPrevented || !(e.target instanceof HTMLElement)) {
    return;
  }

  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(MENU_BUTTON)];
  const currentIdx = items.indexOf(e.target);

  if (currentIdx === -1) {
    return;
  }

  e.preventDefault();
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

const useMenuScope = (list: HTMLElement | null) => {
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

  const onMouseMove = (e: React.MouseEvent) => {
    const row = e.target instanceof Element ? e.target.closest<HTMLElement>(MENU_ITEM) : null;

    if (row !== null) {
      setLit(row);
    }
  };

  const onFocus = (e: React.FocusEvent) => {
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
      onMouseLeave: () => {
        setLit(focused);
      },
      onMouseMove,
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
  } satisfies MenuScope;
};

type SidebarMenuProps = LiHTMLAttributes<HTMLUListElement>;

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

const LIT_TONE = "text-muted-foreground group-data-lit/menu-item:text-foreground";
const LIT_STROKE = "group-data-lit/menu-item:stroke-2";

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
          "peer/menu-button relative z-10 flex h-8 w-full cursor-pointer items-center gap-2 px-2 text-left outline-none select-none",
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

const SidebarMenuAction = ({
  className,
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & RefAttributes<HTMLButtonElement>) => {
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

const YIELDS_TO_ACTION = [
  "group-has-data-[sidebar=menu-action]/menu-item:group-data-lit/menu-item:opacity-0",
  "group-has-[[data-sidebar=menu-action]:focus-visible]/menu-item:opacity-0",
  "group-has-[[data-sidebar=menu-action][data-popup-open]]/menu-item:opacity-0",
].join(" ");

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
