import { render, screen } from "@testing-library/react";
import type { Mounted } from "pele";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { inertSvg } from "@repo/editor/lib/inert-svg";
import MermaidPreview from "@repo/editor/nodes/code-block-mermaid";
import { DIAGRAM_PREVIEW } from "@repo/editor/style-hooks";

// every drawing the preview mounts, so a test can see what the preview asks of it
const mounted = vi.hoisted((): Mounted[] => []);
vi.mock(import("pele"), async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    mount: (...args: Parameters<typeof real.mount>): Mounted => {
      const drawing = real.mount(...args);
      mounted.push(drawing);
      return drawing;
    },
  };
});

const FLOW = "graph TD;\n  A[Draft]-->B[Review];";
// line 3 breaks at its seventh character
const BROKEN = "graph TD;\n  A[Draft]-->B[Review];\n  B-->>>C[";

const host = (container: HTMLElement): HTMLElement => {
  const found = container.querySelector(`.${DIAGRAM_PREVIEW}`);
  if (!(found instanceof HTMLElement)) {
    throw new TypeError("the preview drew no diagram frame");
  }
  return found;
};

const labels = (frame: HTMLElement): string[] =>
  [...frame.querySelectorAll("svg text")].map((text) => text.textContent);

describe("a mermaid fence's preview", () => {
  // jsdom has no canvas and says so on every ask; with none, Pele measures by its own table
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  it("draws the diagram as an svg on its first render", () => {
    const { container } = render(<MermaidPreview code={FLOW} />);
    const frame = host(container);
    expect(frame.querySelectorAll(":scope > svg")).toHaveLength(1);
    expect(labels(frame)).toEqual(expect.arrayContaining(["Draft", "Review"]));
    expect(screen.queryByText(/column/u)).toBeNull();
  });

  it("redraws in the same render as the change, with no wait", () => {
    const view = render(<MermaidPreview code={FLOW} />);
    view.rerender(<MermaidPreview code={FLOW.replace("Review", "Ship")} />);
    expect(labels(host(view.container))).toContain("Ship");
  });

  it("names the line and column a broken source fails at, under the caret Pele draws", () => {
    const { container } = render(<MermaidPreview code={BROKEN} />);
    expect(screen.getByText("Line 3, column 7:")).toBeTruthy();
    expect(screen.getByText(/Expecting 'NODE_STRING'/u)).toBeTruthy();
    expect(container.textContent).toContain("  B-->>>C[\n------^");
    expect(host(container).childElementCount).toBe(0);
  });

  it("keeps the last drawing, dimmed, while the source is broken, and clears both once it mends", () => {
    const view = render(<MermaidPreview code={FLOW} />);
    view.rerender(<MermaidPreview code={BROKEN} />);
    const frame = host(view.container);
    expect(labels(frame)).toContain("Review");
    expect(frame.classList.contains("opacity-40")).toBe(true);

    view.rerender(<MermaidPreview code={FLOW.replace("Review", "Ship")} />);
    expect(labels(frame)).toContain("Ship");
    expect(frame.classList.contains("opacity-40")).toBe(false);
    expect(screen.queryByText(/column/u)).toBeNull();
  });

  it("says what only the drawing finds wrong, on a first render and over a last drawing", () => {
    const impossible = "gantt\n  title T\n  section S\n  t1 :a1, 2024-13-45, 3d";
    const first = render(<MermaidPreview code={impossible} />);
    expect(screen.getByText("Diagram:")).toBeTruthy();
    expect(screen.getByText(/Invalid date/u)).toBeTruthy();
    first.unmount();

    const view = render(<MermaidPreview code={FLOW} />);
    view.rerender(<MermaidPreview code={"sankey-beta\n a,b,10\n b,a,5"} />);
    const frame = host(view.container);
    expect(screen.getByText(/circular links/u)).toBeTruthy();
    expect(labels(frame)).toContain("Review");
    expect(frame.classList.contains("opacity-40")).toBe(true);

    view.rerender(<MermaidPreview code={FLOW.replace("Review", "Ship")} />);
    expect(labels(frame)).toContain("Ship");
    expect(screen.queryByText(/circular links/u)).toBeNull();
    expect(frame.classList.contains("opacity-40")).toBe(false);
  });

  it("says a drawing the guard cannot read could not be drawn, never an empty frame", () => {
    // U+FFFE is no character XML takes, so Pele's markup for this label is not well-formed
    render(<MermaidPreview code={"graph TD;\n  A[bad \uFFFE label]-->B;"} />);
    expect(screen.getByText("This diagram could not be drawn.")).toBeTruthy();
  });

  it("measures again when the appearance on the root element changes, until it unmounts", async () => {
    const view = render(<MermaidPreview code={FLOW} />);
    const drawing = mounted.at(-1);
    if (drawing === undefined) {
      throw new TypeError("the preview mounted no drawing");
    }
    const refresh = vi.spyOn(drawing, "refresh");
    document.documentElement.style.setProperty("--editor-font", "monospace");
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    view.unmount();
    document.documentElement.style.removeProperty("--editor-font");
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("says a source that is no diagram is one, with no place to point at", () => {
    render(<MermaidPreview code="not a diagram" />);
    expect(screen.getByText("Diagram:")).toBeTruthy();
    expect(screen.getByText(/No diagram type detected/u)).toBeTruthy();
  });

  it("draws a diagram's link and image as neither, so nothing remote loads", () => {
    const { container } = render(
      <MermaidPreview
        code={
          'graph TD;\n  A-->B;\n  click A "https://example.com/"\n  B@{ img: "https://example.com/i.png", label: "pic" }'
        }
      />,
    );
    const frame = host(container);
    expect(frame.querySelector("svg")).not.toBeNull();
    expect(frame.querySelectorAll("a, image, [href]")).toHaveLength(0);
  });
});

const svg = (inner: string, attributes = ""): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attributes}>${inner}</svg>`;

describe("the markup a drawing becomes nodes through", () => {
  it("keeps a drawing's shapes, styles and fragment references", () => {
    const drawn = inertSvg(
      svg(
        '<defs><marker id="m"/></defs><path d="M0,0L1,1" marker-end="url(#m)" style="rx:var(--_r)"/><use href="#m"/>',
        'style="max-width:100%"',
      ),
    );
    expect(drawn?.getAttribute("style")).toBe("max-width:100%");
    expect(drawn?.querySelector("path")?.getAttribute("marker-end")).toBe("url(#m)");
    expect(drawn?.querySelector("use")?.getAttribute("href")).toBe("#m");
    expect(drawn?.ownerDocument).toBe(document);
  });

  it("takes out every script, handler, html island, stylesheet and animation", () => {
    const drawn = inertSvg(
      svg(
        '<script>parent.x = 1</script><rect onclick="x()" onload="y()"/><foreignObject><div>hi</div></foreignObject><style>@import url(https://example.com/a.css);</style><set attributeName="href" to="https://example.com/"/><animate attributeName="href"/>',
        'onload="z()"',
      ),
    );
    expect(drawn?.querySelectorAll("script, foreignObject, style, set, animate")).toHaveLength(0);
    expect(drawn?.getAttributeNames()).not.toContain("onload");
    expect(drawn?.querySelector("rect")?.getAttributeNames()).toEqual([]);
  });

  it("takes out every reference that leaves the drawing", () => {
    const drawn = inertSvg(
      svg(
        '<a href="https://example.com/"><text>t</text></a><image xlink:href="https://example.com/i.png"/><rect fill="url(https://example.com/p.svg#g)" style="fill: url( \'//example.com/x\')"/>',
      ),
    );
    expect(drawn?.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(drawn?.querySelector("image")?.getAttributeNames()).toEqual([]);
    expect(drawn?.querySelector("rect")?.getAttributeNames()).toEqual([]);
  });

  it("takes out every element outside the svg namespace, whatever its name", () => {
    const drawn = inertSvg(
      svg(
        '<g><h:img src="https://example.com/p.png"/><h:iframe src="https://example.com/"/><h:meta http-equiv="refresh" content="0;url=https://example.com/r"/><h:link rel="preload" as="image" imagesrcset="https://example.com/a.png 1x"/><rect/></g>',
        'xmlns:h="http://www.w3.org/1999/xhtml"',
      ),
    );
    expect(drawn?.querySelectorAll("*")).toHaveLength(2);
    expect(drawn?.querySelector("g")?.firstElementChild?.localName).toBe("rect");
  });

  it("refuses markup that is not one well-formed svg", () => {
    expect(inertSvg("<svg xmlns='http://www.w3.org/2000/svg'><g></svg>")).toBeNull();
    expect(inertSvg("<html xmlns='http://www.w3.org/1999/xhtml'/>")).toBeNull();
    expect(inertSvg("<svg/>")).toBeNull();
  });
});
