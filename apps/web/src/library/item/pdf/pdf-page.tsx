import { cn } from "@repo/ui/lib/cn";
import { isImeComposing } from "@repo/ui/lib/ime";
import type { PDFPageProxy, PageViewport } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Page } from "react-pdf";

import { cssColor, inkOf } from "./pdf-ink";
import { linesOf } from "./pdf-lines";
import type { PdfLine } from "./pdf-lines";
import type { Color } from "./text-edits";

export interface LineEdit {
  readonly background: Color;
  readonly color: Color;
  readonly line: PdfLine;
  readonly page: number;
  readonly text: string;
}

interface Placed {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

const NEAR = "800px";
const LETTER = 11 / 8.5;

let measurer: CanvasRenderingContext2D | null = null;

const measured = (text: string, font: string) => {
  measurer ??= document.createElement("canvas").getContext("2d");

  if (measurer === null) {
    return null;
  }

  measurer.font = font;

  return measurer.measureText(text).width;
};

const familyOf = (line: PdfLine) => `"${line.fontName}", sans-serif`;

const placedOf = (viewport: PageViewport, scale: number, line: PdfLine) => {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = viewport.transform;
  const xOf = (x: number, y: number) => (x * a + y * c + e) * scale;
  const yOf = (x: number, y: number) => (x * b + y * d + f) * scale;
  const { bottom, left, right, top } = line.box;
  const xs = [xOf(left, bottom), xOf(right, top)];
  const ys = [yOf(left, bottom), yOf(right, top)];

  return {
    height: Math.max(...ys) - Math.min(...ys),
    left: Math.min(...xs),
    top: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
  } satisfies Placed;
};

const useNear = (target: HTMLElement | null) => {
  const [near, setNear] = useState(() => !("IntersectionObserver" in window));

  useEffect(() => {
    if (target === null || near) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(({ isIntersecting }) => isIntersecting)) {
          setNear(true);
        }
      },
      { root: target.closest("[data-pdf-pages]"), rootMargin: NEAR },
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [near, target]);

  return near;
};

const inkAt = (canvas: HTMLCanvasElement | null, placed: Placed) => {
  const context = canvas?.getContext("2d") ?? null;

  if (canvas === null || context === null || canvas.clientWidth === 0) {
    return inkOf(new Uint8ClampedArray());
  }

  const ratio = canvas.width / canvas.clientWidth;

  const pixels = context.getImageData(
    Math.floor(placed.left * ratio),
    Math.floor(placed.top * ratio),
    Math.max(1, Math.ceil(placed.width * ratio)),
    Math.max(1, Math.ceil(placed.height * ratio)),
  );

  return inkOf(pixels.data);
};

const boxStyle = (placed: Placed) =>
  ({
    height: placed.height,
    left: placed.left,
    top: placed.top,
    width: placed.width,
  }) satisfies CSSProperties;

const LineField = ({
  edit,
  fontSize,
  placed,
  onDone,
}: {
  edit: LineEdit;
  fontSize: number;
  placed: Placed;
  onDone: (text: string | null) => void;
}) => {
  const [draft, setDraft] = useState(edit.text);
  const font = `${String(fontSize)}px ${familyOf(edit.line)}`;
  const wide = (measured(draft, font) ?? 0) + fontSize;

  return (
    <input
      aria-label="Line text"
      autoFocus
      spellCheck={false}
      className="absolute z-40 rounded-[2px] border-0 p-0 leading-none outline-2 outline-primary"
      style={{
        ...boxStyle(placed),
        background: cssColor(edit.background),
        color: cssColor(edit.color),
        font,
        width: Math.max(placed.width, wide),
      }}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={() => {
        onDone(draft);
      }}
      onKeyDown={(event) => {
        if (isImeComposing(event)) {
          return;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          onDone(draft);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onDone(null);
        }
      }}
    />
  );
};

const EditedText = ({
  edit,
  fontSize,
  placed,
}: {
  edit: LineEdit;
  fontSize: number;
  placed: Placed;
}) => (
  <span
    className="pointer-events-none absolute top-0 left-0 whitespace-pre"
    style={{
      background: cssColor(edit.background),
      color: cssColor(edit.color),
      font: `${String(fontSize)}px ${familyOf(edit.line)}`,
      height: placed.height,
      lineHeight: `${String(placed.height)}px`,
      minWidth: placed.width,
    }}
  >
    {edit.text}
  </span>
);

interface Active {
  readonly edit: LineEdit;
  readonly key: string;
}

export const PdfPage = ({
  editing,
  edits,
  index,
  onEdit,
  width,
}: {
  editing: boolean;
  edits: ReadonlyMap<string, LineEdit>;
  index: number;
  onEdit: (key: string, edit: LineEdit | null) => void;
  width: number;
}) => {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [lines, setLines] = useState<readonly PdfLine[]>([]);
  const near = useNear(frame);
  const viewport = page?.getViewport({ scale: 1 }) ?? null;
  const scale = viewport === null ? 0 : width / viewport.width;
  const height = viewport === null ? width * LETTER : viewport.height * scale;
  const editable = viewport?.rotation === 0 && editing ? lines : [];

  return (
    <div
      ref={setFrame}
      data-page={index + 1}
      className="relative mx-auto shrink-0 bg-white shadow-sm"
      style={{ height, width }}
    >
      {near ? (
        <Page
          pageNumber={index + 1}
          width={width}
          canvasRef={canvas}
          loading={null}
          suspense={false}
          className="[&_.textLayer]:select-text"
          onLoadSuccess={setPage}
          onGetTextSuccess={({ items, styles }) => {
            setLines(linesOf(items, styles));
          }}
        />
      ) : null}
      {viewport === null
        ? null
        : editable.map((line, at) => {
            const key = `${String(index)}:${String(at)}`;
            const placed = placedOf(viewport, scale, line);
            const fontSize = line.size * scale;
            const edit = edits.get(key) ?? null;

            if (active?.key === key) {
              return (
                <LineField
                  key={key}
                  edit={active.edit}
                  fontSize={fontSize}
                  placed={placed}
                  onDone={(text) => {
                    setActive(null);

                    if (text !== null) {
                      onEdit(key, text === line.text ? null : { ...active.edit, text });
                    }
                  }}
                />
              );
            }

            return (
              <button
                key={key}
                type="button"
                aria-label={`Edit “${edit?.text ?? line.text}”`}
                className={cn(
                  "absolute z-30 cursor-text rounded-[2px] p-0 hover:outline-2 hover:outline-primary/60",
                  edit !== null && "outline-1 outline-primary/40",
                )}
                style={boxStyle(placed)}
                onClick={() => {
                  setActive({
                    edit: edit ?? {
                      ...inkAt(canvas.current, placed),
                      line,
                      page: index,
                      text: line.text,
                    },
                    key,
                  });
                }}
              >
                {edit === null ? null : (
                  <EditedText edit={edit} fontSize={fontSize} placed={placed} />
                )}
              </button>
            );
          })}
    </div>
  );
};
