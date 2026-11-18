const paragraph = (index: number) =>
  `<p>Paragraph ${String(index)} opens with <a href="/notes/${String(index)}">a link</a>, reads on with <em>some emphasis</em>, and closes with a plain sentence of ordinary prose.</p>`;

interface LongPage {
  readonly html: string;
  readonly paragraphs: number;
}

export const longPage = (articleChars: number, chromeChars = 0) => {
  const parts: string[] = [];
  let size = 0;

  for (let index = 0; size < articleChars; index += 1) {
    const part = `${index % 50 === 0 ? `<h2>Section ${String(index)}</h2>` : ""}${paragraph(index)}`;
    parts.push(part);
    size += part.length;
  }

  const chrome = `<script>window.track = "${"x".repeat(chromeChars)}";</script>`;

  return {
    html: `<!doctype html><html lang="en"><head><title>A long page</title>${chrome}</head><body><nav><a href="/">Home</a></nav><article><h1>A long page</h1>${parts.join("")}</article></body></html>`,
    paragraphs: parts.length,
  } satisfies LongPage;
};
