// A page as long as a test asks: numbered paragraphs of prose with a link and emphasis each, a
// heading every fifty, inside an article, behind as much chrome (a script, a menu) as asked, so a
// suite can hand the reader a page past any budget without committing one.

const paragraph = (index: number): string =>
  `<p>Paragraph ${String(index)} opens with <a href="/notes/${String(index)}">a link</a>, reads on with <em>some emphasis</em>, and closes with a plain sentence of ordinary prose.</p>`;

export interface LongPage {
  readonly html: string;
  // how many paragraphs the article holds
  readonly paragraphs: number;
}

export const longPage = (articleChars: number, chromeChars = 0): LongPage => {
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
  };
};
