// every negotiated response carries it, or a cache hands the markdown to a browser (or the HTML
// to an agent) depending on which variant primed it first
export const VARY = "Accept, Accept-Encoding";

type Representation = "html" | "markdown";

const MEDIA: Record<Representation, readonly [string, string]> = {
  html: ["text", "html"],
  markdown: ["text", "markdown"],
};

interface MediaRange {
  type: string;
  subtype: string;
  q: number;
}

const parseQ = (params: string[]): number => {
  for (const param of params) {
    const [key, value] = param.split("=");
    if (key?.trim().toLowerCase() === "q") {
      const q = Number(value?.trim());
      return Number.isNaN(q) ? 1 : Math.min(1, Math.max(0, q));
    }
  }
  return 1;
};

const parseAccept = (header: string): MediaRange[] =>
  header.split(",").flatMap((raw) => {
    const [media = "", ...params] = raw.split(";");
    const [type, subtype] = media.trim().toLowerCase().split("/");
    return type && subtype ? [{ q: parseQ(params), subtype, type }] : [];
  });

const specificity = (range: MediaRange): number => {
  if (range.type === "*") {
    return 0;
  }
  return range.subtype === "*" ? 1 : 2;
};

// the most specific matching range decides, so `text/markdown;q=0, */*` refuses markdown
const qualityOf = (ranges: MediaRange[], representation: Representation): number => {
  const [type, subtype] = MEDIA[representation];
  let best: MediaRange | undefined;
  for (const range of ranges) {
    const matches =
      range.type === "*" ||
      (range.type === type && (range.subtype === "*" || range.subtype === subtype));
    if (matches && (best === undefined || specificity(range) > specificity(best))) {
      best = range;
    }
  }
  return best?.q ?? 0;
};

/** Markdown only when the client ranks it strictly above HTML; every tie keeps the HTML page. */
export const prefersMarkdown = (accept: string | null): boolean => {
  if (accept === null) {
    return false;
  }
  const ranges = parseAccept(accept);
  return qualityOf(ranges, "markdown") > qualityOf(ranges, "html");
};

export const markdownResponse = (body: string, init: ResponseInit = {}): Response =>
  new Response(body, {
    status: 200,
    ...init,
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: VARY,
      ...init.headers,
    },
  });
