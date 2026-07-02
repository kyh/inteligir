/* Adapted from Plate Plus Potion (https://pro.platejs.org) — used under the
 * held Plate Plus license. */
// Column layout with OWNED drag-resize (no @platejs/resizable): live drag
// mutates the two flanking columns' DOM flex-basis imperatively (no re-render,
// no node write, no autosave churn); pointer-up commits every column's width
// to the document ONCE via setNodes — percentage strings with ≤2 decimals
// ("50%", "33.33%") summing to exactly 100. Until that first commit, columns
// stay BARE (equal widths via flex-grow) — the locked canonical insert form.
//
// Width rendering: committed columns use `flex: 0 1 <width>` (basis carries
// the ratio, shrink absorbs the row's gap space); bare columns use
// `flex: 1 1 0%`. Commit percentages are normalized against the SUM of column
// pixel widths, so gaps never skew the stored ratios.

import { useRef } from "react";
import { ElementApi, PathApi } from "platejs";
import {
  PlateElement,
  useEditorRef,
  useElement,
  useReadOnly,
  type PlateElementProps,
} from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

const MIN_PCT = 10;

// ≤2 decimals, trailing zeros trimmed: 50 → "50%", 33.333 → "33.33%".
function formatPct(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

export function ColumnGroupElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className="mb-1">
      <div className="flex size-full gap-4 rounded">{props.children}</div>
    </PlateElement>
  );
}

export function ColumnElement(props: PlateElementProps) {
  const readOnly = useReadOnly();
  const editor = useEditorRef();
  const element = useElement();
  const hostRef = useRef<HTMLDivElement | null>(null);

  const width = typeof element.width === "string" ? element.width : undefined;

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const path = editor.api.findPath(element);
    const host = hostRef.current;
    const groupRow = host?.parentElement;
    if (!path || !host || !groupRow) return;
    const next = host.nextElementSibling;
    if (!(next instanceof HTMLElement)) return;

    e.preventDefault();
    // Pointer capture routes move/up/cancel to the handle even when the
    // pointer leaves it (or the window) mid-drag; pointercancel (tab switch,
    // OS gesture, touch interruption) aborts without committing.
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const cells = Array.from(groupRow.children).filter(
      (cell): cell is HTMLElement => cell instanceof HTMLElement,
    );
    const startPx = cells.map((cell) => cell.getBoundingClientRect().width);
    const totalPx = startPx.reduce((sum, px) => sum + px, 0);
    const selfIndex = cells.indexOf(host);
    const nextIndex = cells.indexOf(next);
    const startSelf = startPx[selfIndex] ?? 0;
    const startNext = startPx[nextIndex] ?? 0;
    const pairPx = startSelf + startNext;
    const minPx = (MIN_PCT / 100) * totalPx;

    const clampDelta = (clientX: number): number =>
      Math.min(Math.max(clientX - startX, minPx - startSelf), startNext - minPx);

    const onMove = (move: PointerEvent) => {
      const delta = clampDelta(move.clientX);
      // Imperative during drag: fixed-px basis overrides both the flex-grow
      // fallback and any committed width without touching React or Slate.
      host.style.flex = `0 0 ${startSelf + delta}px`;
      next.style.flex = `0 0 ${pairPx - (startSelf + delta)}px`;
    };

    const detach = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      host.style.flex = "";
      next.style.flex = "";
    };

    // Aborted drag (pointercancel): restore the flex-driven layout, commit
    // nothing — the document stays untouched.
    const onCancel = () => {
      detach();
    };

    const onUp = (up: PointerEvent) => {
      detach();
      const delta = clampDelta(up.clientX);
      if (delta === 0) return; // no movement — document untouched
      // Commit-on-release: every column gets a width so the group is fully
      // width-formed; the last column absorbs rounding so widths sum to 100.
      const finalPx = startPx.map((px, i) =>
        i === selfIndex ? startSelf + delta : i === nextIndex ? startNext - delta : px,
      );
      const rounded = finalPx.map((px) => Number(((px / totalPx) * 100).toFixed(2)));
      const sumButLast = rounded.slice(0, -1).reduce((sum, pct) => sum + pct, 0);
      rounded[rounded.length - 1] = Number((100 - sumButLast).toFixed(2));
      const groupPath = PathApi.parent(path);
      editor.tf.withoutNormalizing(() => {
        rounded.forEach((pct, i) => {
          editor.tf.setNodes({ width: formatPct(pct) }, { at: groupPath.concat([i]) });
        });
      });
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
  };

  const path = editor.api.findPath(element);
  const isLast = (() => {
    if (!path) return true;
    const parent = editor.api.node(PathApi.parent(path));
    if (!parent || !ElementApi.isElement(parent[0])) return true;
    return path[path.length - 1] === parent[0].children.length - 1;
  })();

  return (
    <PlateElement
      {...props}
      ref={hostRef}
      className={cn(
        "group/column relative",
        !readOnly && "rounded-lg border border-dashed border-border p-1.5",
      )}
      style={width ? { flex: `0 1 ${width}` } : { flex: "1 1 0%" }}
    >
      {props.children}
      {!readOnly && !isLast ? (
        <div
          contentEditable={false}
          onPointerDown={startResize}
          className="absolute inset-y-0 -right-[10.5px] z-10 flex w-[13px] cursor-col-resize items-center justify-center opacity-0 transition-opacity select-none group-hover/column:opacity-100 hover:opacity-100"
        >
          <div className="h-full w-[3px] rounded-full bg-border hover:bg-primary/40" />
        </div>
      ) : null}
    </PlateElement>
  );
}
