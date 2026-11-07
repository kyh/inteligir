// each indexable page's metadata, in one table the route heads, the JSON-LD, the sitemap and the
// OG card renderer (scripts/og-cards.ts) all read. No imports: node runs that script by
// stripping types, so this file must resolve with no bundler aliases.

type PageKind = "home" | "about" | "contact" | "legal";

export interface PageMeta {
  path: "/" | "/about" | "/contact" | "/privacy" | "/terms";
  kind: PageKind;
  // the page's own name, without the site's; the <title> appends it
  title: string;
  description: string;
  // under public/; 1200x630 cards rendered by `pnpm og:cards`, but the home page's 1920x1080 og.jpg
  image: { path: string; width: number; height: number; alt: string };
}

const card = (slug: string, alt: string): PageMeta["image"] => ({
  alt,
  height: 630,
  path: `/og/${slug}.jpg`,
  width: 1200,
});

export const PAGES = {
  about: {
    description:
      "Why Inteligir exists: one library on every device you use, an AI agent built in, and every change it makes reversible.",
    image: card("about", "About Inteligir"),
    kind: "about",
    path: "/about",
    title: "About",
  },
  contact: {
    description:
      "How to reach the maker of Inteligir for questions, invites, feedback, bug reports and privacy requests.",
    image: card("contact", "Contact Inteligir"),
    kind: "contact",
    path: "/contact",
    title: "Contact",
  },
  home: {
    description:
      "One library for the links, articles, images, PDFs and files you save and the notes you write, on your Mac, your iPhone and in a browser, with a built-in AI agent that files, tags and edits it with you.",
    image: {
      // what og.jpg shows, the tagline written into it included
      alt: "Inteligir: the workspace for knowledge work",
      height: 1080,
      path: "/og.jpg",
      width: 1920,
    },
    kind: "home",
    path: "/",
    title: "one library for everything you save",
  },
  privacy: {
    description:
      "Inteligir's privacy policy: exactly what each device sends, what our cloud keeps and for how long, and how to delete it.",
    image: card("privacy", "Inteligir privacy policy"),
    kind: "legal",
    path: "/privacy",
    title: "Privacy Policy",
  },
  terms: {
    description: "The terms for using the Inteligir website, the Mac app and the iPhone app.",
    image: card("terms", "Inteligir terms of use"),
    kind: "legal",
    path: "/terms",
    title: "Terms of Use",
  },
} as const satisfies Record<string, PageMeta>;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const MONTH_NUMBERS = new Map<string, number>(MONTHS.map((name, index) => [name, index + 1]));

/** The ISO date a legal doc states it took effect ("Effective as of October 3, 2026"), or null. */
export const statedDate = (markdown: string): string | null => {
  const groups =
    /(?:Effective as of|Last revised:\*\*)\s+(?<month>[A-Z][a-z]+) (?<day>\d{1,2}), (?<year>\d{4})/u.exec(
      markdown,
    )?.groups;
  const month = MONTH_NUMBERS.get(groups?.month ?? "");
  if (groups === undefined || month === undefined) {
    return null;
  }
  return `${groups.year}-${String(month).padStart(2, "0")}-${(groups.day ?? "").padStart(2, "0")}`;
};
