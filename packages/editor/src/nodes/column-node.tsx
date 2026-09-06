// Vendored from plate (github.com/udecode/plate), MIT. © Plate contributors.
// Live drag mutates the two flanking columns' flex-basis imperatively; pointer-up commits every
// width once via setNodes. Percentages are normalized against the sum of column pixel widths,
// so gaps never skew the stored ratios.

import { useRef } from "react";
import { ElementApi, PathApi } from "platejs";
import {
  PlateElement,
  useEditorRef,
  useElement,
  useReadOnly,
  type PlateElementProps,
} from "platejs/react";

import { cn } from "cn";

import { stringProp } from "@repo/editor/node-props";

const MIN_PCT = 10;

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

  const width = stringProp(element, "width");

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const path = editor.api.findPath(element);
    const host = hostRef.current;
    const groupRow = host?.parentElement;
    if (!path || !host || !groupRow) return;
    const next = host.nextElementSibling;
    if (!(next instanceof HTMLElement)) return;

    e.preventDefault();
    // capture is best effort; the listeners live on window, and pointercancel aborts without committing.
    const handle = e.currentTarget;
    if ("setPointerCapture" in handle) {
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        // synthetic pointers (tests) may not be capturable.
      }
    }
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
      host.style.flex = `0 0 ${startSelf + delta}px`;
      next.style.flex = `0 0 ${pairPx - (startSelf + delta)}px`;
    };

    const detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      host.style.flex = "";
      next.style.flex = "";
    };

    const onCancel = () => {
      detach();
    };

    const onUp = (up: PointerEvent) => {
      detach();
      const delta = clampDelta(up.clientX);
      if (delta === 0) return;
      // the last column absorbs rounding so widths sum to 100.
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

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
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
