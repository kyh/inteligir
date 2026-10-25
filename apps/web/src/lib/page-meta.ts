// each indexable page's metadata, in one table the route heads, the JSON-LD, the sitemap and the
// OG card renderer (scripts/og-video.ts) all read. No imports: node runs that script by
// stripping types, so this file must resolve with no bundler aliases.

type PageKind = "home" | "about" | "contact" | "legal";

export interface PageMeta {
  path: "/" | "/about" | "/contact" | "/privacy" | "/terms";
  kind: PageKind;
  // the page's own name, without the site's; the <title> appends it
  title: string;
  description: string;
  // under public/; 1200x630 cards rendered by `pnpm og:video`, but the home page's 1920x1080 og.jpg
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
      "Why Inteligir exists: plain markdown notes you own, an AI agent on your own Claude or ChatGPT plan, and every change it makes reversible.",
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
      "A notes app for the Mac where an AI agent, running on your own Claude or ChatGPT plan, edits your markdown notes with you. Every change is kept and can be undone.",
    image: {
      alt: "Inteligir: the workspace for knowledge work",
      height: 1080,
      path: "/og.jpg",
      width: 1920,
    },
    kind: "home",
    path: "/",
    title: "the workspace for knowledge work",
  },
  privacy: {
    description:
      "Inteligir's privacy policy: exactly what leaves your Mac when you use the app, the site and an account, and what never does.",
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

// the home page's clip (scripts/og-video.ts records scripts/og-video/scene.html): the user asks
// the agent beside a rough note, the agent's edits stream into it, then the icon over the tagline
export const HOME_VIDEO = {
  description:
    "In Inteligir, you ask the agent to turn rough meeting notes into an agenda, and its edits land in your note line by line, each one marked as it arrives. It closes on the Inteligir icon over its tagline.",
  duration: "PT9.6S",
  height: 630,
  name: "An agent edits a note with you in Inteligir",
  path: "/og/og.mp4",
  poster: "/og/og-poster.jpg",
  uploadDate: "2026-10-25",
  width: 1200,
} as const;

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
