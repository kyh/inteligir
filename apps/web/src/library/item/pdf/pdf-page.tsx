import { cn } from "@repo/ui/lib/cn";
import { isImeComposing } from "@repo/ui/lib/ime";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";

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

interface Laid {
  readonly lines: readonly PdfLine[];
  readonly page: PDFPageProxy;
  readonly viewport: PageViewport;
}

interface Placed {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

const NEAR = "800px";

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
      { rootMargin: NEAR },
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [near, target]);

  return near;
};

const useLaid = (doc: PDFDocumentProxy, index: number) => {
  const [laid, setLaid] = useState<Laid | null>(null);

  useEffect(() => {
    let live = true;

    const lay = async () => {
      const page = await doc.getPage(index + 1);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      if (live) {
        setLaid({
          lines: viewport.rotation === 0 ? linesOf(content.items, content.styles) : [],
          page,
          viewport,
        });
      }
    };

    lay().catch(() => null);

    return () => {
      live = false;
    };
  }, [doc, index]);

  return laid;
};

const useDrawn = (
  drawn: RefObject<HTMLCanvasElement | null>,
  laid: Laid | null,
  scale: number,
  near: boolean,
) => {
  useEffect(() => {
    const canvas = drawn.current;

    if (canvas === null || laid === null || !near || scale <= 0) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const viewport = laid.page.getViewport({ scale: scale * ratio });
    sized(canvas, viewport);
    const task = laid.page.render({ canvas, viewport });
    task.promise.catch(() => null);

    return () => {
      task.cancel();
    };
  }, [drawn, laid, near, scale]);
};

const sized = (canvas: HTMLCanvasElement, { height, width }: PageViewport) => {
  canvas.width = Math.floor(width);
  canvas.height = Math.floor(height);
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
      className="absolute z-20 rounded-[2px] border-0 p-0 leading-none outline-2 outline-primary"
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

const LineText = ({
  line,
  placed,
  fontSize,
}: {
  line: PdfLine;
  placed: Placed;
  fontSize: number;
}) => {
  const font = `${String(fontSize)}px ${familyOf(line)}`;
  const natural = measured(line.text, font);
  const stretch = natural === null || natural === 0 ? 1 : placed.width / natural;

  return (
    <span
      className="absolute origin-top-left whitespace-pre text-transparent select-text"
      style={{
        font,
        left: placed.left,
        lineHeight: `${String(placed.height)}px`,
        top: placed.top,
        transform: `scaleX(${String(stretch)})`,
      }}
    >
      {line.text}
    </span>
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
  doc,
  editing,
  edits,
  index,
  onEdit,
  width,
}: {
  doc: PDFDocumentProxy;
  editing: boolean;
  edits: ReadonlyMap<string, LineEdit>;
  index: number;
  onEdit: (key: string, edit: LineEdit | null) => void;
  width: number;
}) => {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const laid = useLaid(doc, index);
  const near = useNear(frame);
  const scale = laid === null ? 0 : width / laid.viewport.width;
  useDrawn(canvas, laid, scale, near);
  const height = laid === null ? width * 1.294 : laid.viewport.height * scale;

  return (
    <div
      ref={setFrame}
      data-page={index + 1}
      className="relative mx-auto shrink-0 bg-white shadow-sm"
      style={{ height, width }}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      {laid?.lines.map((line, at) => {
        const key = `${String(index)}:${String(at)}`;
        const placed = placedOf(laid.viewport, scale, line);
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

        if (!editing) {
          return <LineText key={key} line={line} placed={placed} fontSize={fontSize} />;
        }

        return (
          <button
            key={key}
            type="button"
            aria-label={`Edit “${edit?.text ?? line.text}”`}
            className={cn(
              "absolute z-10 cursor-text rounded-[2px] p-0 hover:outline-2 hover:outline-primary/60",
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
            {edit === null ? null : <EditedText edit={edit} fontSize={fontSize} placed={placed} />}
          </button>
        );
      })}
    </div>
  );
};
