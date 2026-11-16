// A url's key is a row `deriveItem` writes with every write of the item
// (`../library/derive-item.ts`).

import { safeDecode } from "../text/safe-decode";

// a pasted address holds no whitespace or control character; a browser escapes them all
const holdsSpaceOrControl = (value: string): boolean => {
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x20 || (cp >= 0x7f && cp <= 0x9f) || /\s/u.test(ch)) {
      return true;
    }
  }
  return false;
};

// URL alone also takes `https:example.com`, `https:///path` and `https:\\host`
const WEB_PREFIX = /^https?:\/\/[^/?#\\]/iu;

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const parseWebUrl = (value: string): URL | null => {
  const trimmed = value.trim();
  if (!WEB_PREFIX.test(trimmed) || holdsSpaceOrControl(trimmed)) {
    return null;
  }
  const url = parseUrl(trimmed);
  return url === null || url.hostname.replace(/\.$/u, "") === "" ? null : url;
};

export const isWebUrl = (value: string): boolean => parseWebUrl(value) !== null;

const bareHost = (url: URL): string => url.hostname.replace(/\.$/u, "").replace(/^www\./u, "");

// lowercased, no `www.`, no port
export const urlHost = (value: string): string | null => {
  const url = parseWebUrl(value);
  return url === null ? null : bareHost(url);
};

const HOST_ALIASES = new Map([
  ["m.youtube.com", "youtube.com"],
  ["mobile.twitter.com", "twitter.com"],
  ["music.youtube.com", "youtube.com"],
  ["x.com", "twitter.com"],
]);

const MOBILE_WIKIPEDIA = /^(?<lang>.+)\.m\.wikipedia\.org$/u;

const SHORT_YOUTUBE_HOST = "youtu.be";

// the host the key and the per-host rules see
const aliasedHost = (url: URL): string => {
  const host = bareHost(url);
  if (host === SHORT_YOUTUBE_HOST) {
    return "youtube.com";
  }
  const lang = MOBILE_WIKIPEDIA.exec(host)?.groups?.lang;
  if (lang !== undefined) {
    return `${lang}.wikipedia.org`;
  }
  return HOST_ALIASES.get(host) ?? host;
};

const TRACKING_PARAMS = new Set([
  "_hsenc",
  "_hsmi",
  "dclid",
  "fbclid",
  "gbraid",
  "gclid",
  "igsh",
  "igshid",
  "li_fat_id",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "msclkid",
  "oly_anon_id",
  "oly_enc_id",
  "rb_clickid",
  "ref_src",
  "ref_url",
  "s_cid",
  "srsltid",
  "ttclid",
  "twclid",
  "vero_id",
  "wbraid",
  "yclid",
]);

const HOST_TRACKING_PARAMS = new Map([
  ["open.spotify.com", new Set(["context", "si"])],
  ["twitter.com", new Set(["s", "t"])],
  ["youtube.com", new Set(["feature", "pp", "si"])],
]);

const ESCAPE = /%[\dA-Fa-f]{2}/gu;
const UNRESERVED = /^[\w.~-]$/u;

// URL leaves an escape as written: its case is folded and an unreserved one decoded here
const normalizeEscapes = (text: string): string =>
  text.replaceAll(ESCAPE, (escape) => {
    const hex = escape.slice(1).toUpperCase();
    const decoded = String.fromCodePoint(Number.parseInt(hex, 16));
    return UNRESERVED.test(decoded) ? decoded : `%${hex}`;
  });

const keyPath = (pathname: string): string => {
  const clean = normalizeEscapes(pathname);
  return clean.length > 1 && clean.endsWith("/") ? clean.slice(0, -1) : clean;
};

const paramName = (piece: string): string => {
  const eq = piece.indexOf("=");
  return normalizeEscapes(eq === -1 ? piece : piece.slice(0, eq));
};

const isTrackingParam = (piece: string, host: string): boolean => {
  const name = paramName(piece).toLowerCase();
  return (
    name.startsWith("utm_") ||
    TRACKING_PARAMS.has(name) ||
    (HOST_TRACKING_PARAMS.get(host)?.has(name) ?? false)
  );
};

// split by hand: URLSearchParams writes a kept parameter back in its own spelling
const queryPieces = (url: URL): string[] =>
  url.search === "" ? [] : url.search.slice(1).split("&");

const firstSegment = (path: string): string => path.split("/").find((s) => s !== "") ?? "";

const compareStrings = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

const keyQuery = (pieces: readonly string[], host: string): string =>
  pieces
    .filter((piece) => piece !== "" && !isTrackingParam(piece, host))
    .map((piece) => {
      const eq = piece.indexOf("=");
      return eq === -1
        ? { name: normalizeEscapes(piece), value: null }
        : {
            name: normalizeEscapes(piece.slice(0, eq)),
            value: normalizeEscapes(piece.slice(eq + 1)),
          };
    })
    .toSorted(
      (a, b) => compareStrings(a.name, b.name) || compareStrings(a.value ?? "", b.value ?? ""),
    )
    .map(({ name, value }) => (value === null ? name : `${name}=${value}`))
    .join("&");

// a route fragment (`#/inbox`, `#!/post`) addresses a different page; any other is a place in it
const isRouteFragment = (fragment: string): boolean =>
  fragment.startsWith("/") || fragment.startsWith("!");

interface UrlKeyParts {
  host: string;
  path: string;
  query: string;
}

const keyPartsOf = (url: URL): UrlKeyParts => {
  const host = aliasedHost(url);
  const pieces = queryPieces(url);
  if (bareHost(url) === SHORT_YOUTUBE_HOST) {
    const id = normalizeEscapes(firstSegment(url.pathname));
    return {
      host,
      path: id === "" ? "/" : "/watch",
      query: keyQuery(id === "" ? pieces : [...pieces, `v=${id}`], host),
    };
  }
  return { host, path: keyPath(url.pathname), query: keyQuery(pieces, host) };
};

// an address's last path segment, decoded ("" when it names none)
export const urlLastSegment = (value: string): string =>
  safeDecode(
    parseWebUrl(value)
      ?.pathname.split("/")
      .findLast((part) => part !== "") ?? "",
  );

const YOUTUBE_ID = /^[\w-]{6,20}$/u;
const YOUTUBE_PATH_ID = /^\/(?:shorts|live|embed)\/(?<id>[^/]+)/u;

const youTubeIdOf = (url: URL): string | null => {
  const host = bareHost(url);
  if (host === SHORT_YOUTUBE_HOST) {
    return safeDecode(firstSegment(url.pathname));
  }
  if (host !== "youtube.com" && !host.endsWith(".youtube.com")) {
    return null;
  }
  const fromPath = YOUTUBE_PATH_ID.exec(url.pathname)?.groups?.id;
  return url.searchParams.get("v") ?? (fromPath === undefined ? null : safeDecode(fromPath));
};

// a YouTube video's id, from any of its addresses (a watch page, a short link, a short, a live, an
// embed); null for any other address
export const youTubeVideoId = (value: string): string | null => {
  const url = parseWebUrl(value);
  const id = url === null ? null : youTubeIdOf(url);
  return id !== null && YOUTUBE_ID.test(id) ? id : null;
};

// the dedupe key: no scheme or userinfo, the host folded and aliased, the path normalized, the
// tracking parameters dropped and the rest sorted, a fragment kept only when it is a route
export const urlKey = (value: string): string | null => {
  const url = parseWebUrl(value);
  if (url === null) {
    return null;
  }
  const { host, path, query } = keyPartsOf(url);
  const fragment = url.hash.slice(1);
  return `${url.port === "" ? host : `${host}:${url.port}`}${path}${query === "" ? "" : `?${query}`}${isRouteFragment(fragment) ? `#${normalizeEscapes(fragment)}` : ""}`;
};

// what is written to `url:`: the address as URL writes it, less its userinfo and its tracking
// parameters
export const cleanUrl = (value: string): string | null => {
  const url = parseWebUrl(value);
  if (url === null) {
    return null;
  }
  const host = aliasedHost(url);
  const kept = queryPieces(url).filter((piece) => piece !== "" && !isTrackingParam(piece, host));
  const search = kept.length === 0 ? "" : `?${kept.join("&")}`;
  return `${url.protocol}//${url.host}${url.pathname}${search}${url.hash}`;
};

// the host and the path's words, for the search index's meta column
export const urlSearchText = (value: string): string => {
  const url = parseWebUrl(value);
  if (url === null) {
    return "";
  }
  const words = safeDecode(url.pathname)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
  return [bareHost(url), ...words].join(" ");
};

// what a `site` filter names: a host, or an address reduced to its host
const siteFilterHost = (filter: string): string => {
  const trimmed = filter.trim();
  if (trimmed === "") {
    return "";
  }
  return (
    urlHost(trimmed) ??
    urlHost(`https://${trimmed}`) ??
    trimmed
      .toLowerCase()
      .replace(/\.$/u, "")
      .replace(/^www\./u, "")
  );
};

// a host matches its own name and every subdomain of it
export const siteMatches = (host: string | null, filter: string): boolean => {
  const site = siteFilterHost(filter);
  return host !== null && site !== "" && (host === site || host.endsWith(`.${site}`));
};

const SPOTIFY_AUDIO = /^\/(?:album|episode|playlist|show|track)\//u;

const isVideo = (host: string, path: string): boolean => {
  switch (host) {
    case "youtube.com": {
      return path === "/watch" || path.startsWith("/shorts/") || path.startsWith("/live/");
    }
    case "vimeo.com": {
      return path.split("/").some((segment) => /^\d+$/u.test(segment));
    }
    case "tiktok.com": {
      return path.includes("/video/");
    }
    case "dailymotion.com": {
      return path.startsWith("/video/");
    }
    case "loom.com": {
      return path.startsWith("/share/");
    }
    default: {
      return false;
    }
  }
};

const isAudio = (host: string, path: string): boolean => {
  switch (host) {
    case "open.spotify.com": {
      return SPOTIFY_AUDIO.test(path);
    }
    case "soundcloud.com": {
      return path.split("/").filter((segment) => segment !== "").length >= 2;
    }
    case "music.apple.com":
    case "podcasts.apple.com": {
      return true;
    }
    default: {
      return false;
    }
  }
};

// what a saved address is, by its host after aliasing; a fill may still change it
export const kindForUrl = (value: string): "link" | "video" | "audio" => {
  const url = parseWebUrl(value);
  if (url === null) {
    return "link";
  }
  const { host, path } = keyPartsOf(url);
  if (isVideo(host, path)) {
    return "video";
  }
  return isAudio(host, path) ? "audio" : "link";
};
