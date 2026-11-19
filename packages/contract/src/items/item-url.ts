import { safeDecode } from "../text/safe-decode";

const holdsSpaceOrControl = (value: string) => {
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;

    if (cp <= 0x20 || (cp >= 0x7f && cp <= 0x9f) || /\s/u.test(ch)) {
      return true;
    }
  }

  return false;
};

const WEB_PREFIX = /^https?:\/\/[^/?#\\]/iu;

const parseUrl = (value: string) => {
  try {
    return new URL(value) satisfies URL | null;
  } catch {
    return null;
  }
};

const parseWebUrl = (value: string) => {
  const trimmed = value.trim();

  if (!WEB_PREFIX.test(trimmed) || holdsSpaceOrControl(trimmed)) {
    return null;
  }

  const url = parseUrl(trimmed);

  return url === null || url.hostname.replace(/\.$/u, "") === "" ? null : url;
};

export const isWebUrl = (value: string) => parseWebUrl(value) !== null;

const bareHost = (url: URL) => url.hostname.replace(/\.$/u, "").replace(/^www\./u, "");

export const urlHost = (value: string) => {
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

const aliasedHost = (url: URL) => {
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

const normalizeEscapes = (text: string) =>
  text.replaceAll(ESCAPE, (escape) => {
    const hex = escape.slice(1).toUpperCase();
    const decoded = String.fromCodePoint(Number.parseInt(hex, 16));

    return UNRESERVED.test(decoded) ? decoded : `%${hex}`;
  });

const keyPath = (pathname: string) => {
  const clean = normalizeEscapes(pathname);

  return clean.length > 1 && clean.endsWith("/") ? clean.slice(0, -1) : clean;
};

const paramName = (piece: string) => {
  const eq = piece.indexOf("=");

  return normalizeEscapes(eq === -1 ? piece : piece.slice(0, eq));
};

const isTrackingParam = (piece: string, host: string) => {
  const name = paramName(piece).toLowerCase();

  return (
    name.startsWith("utm_") ||
    TRACKING_PARAMS.has(name) ||
    (HOST_TRACKING_PARAMS.get(host)?.has(name) ?? false)
  );
};

const queryPieces = (url: URL) =>
  (url.search === "" ? [] : url.search.slice(1).split("&")) satisfies string[];

const firstSegment = (path: string) => path.split("/").find((s) => s !== "") ?? "";

const compareStrings = (a: string, b: string) => {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
};

const keyQuery = (pieces: readonly string[], host: string) =>
  pieces
    .flatMap((piece) => {
      if (piece === "" || isTrackingParam(piece, host)) {
        return [];
      }

      const eq = piece.indexOf("=");

      return [
        eq === -1
          ? { name: normalizeEscapes(piece), value: null }
          : {
              name: normalizeEscapes(piece.slice(0, eq)),
              value: normalizeEscapes(piece.slice(eq + 1)),
            },
      ];
    })
    .toSorted(
      (a, b) => compareStrings(a.name, b.name) || compareStrings(a.value ?? "", b.value ?? ""),
    )
    .map(({ name, value }) => (value === null ? name : `${name}=${value}`))
    .join("&");

const isRouteFragment = (fragment: string) => fragment.startsWith("/") || fragment.startsWith("!");

interface UrlKeyParts {
  host: string;
  path: string;
  query: string;
}

const keyPartsOf = (url: URL) => {
  const host = aliasedHost(url);
  const pieces = queryPieces(url);

  if (bareHost(url) === SHORT_YOUTUBE_HOST) {
    const id = normalizeEscapes(firstSegment(url.pathname));

    return {
      host,
      path: id === "" ? "/" : "/watch",
      query: keyQuery(id === "" ? pieces : [...pieces, `v=${id}`], host),
    } satisfies UrlKeyParts;
  }

  return { host, path: keyPath(url.pathname), query: keyQuery(pieces, host) } satisfies UrlKeyParts;
};

export const urlLastSegment = (value: string) =>
  safeDecode(
    parseWebUrl(value)
      ?.pathname.split("/")
      .findLast((part) => part !== "") ?? "",
  );

const YOUTUBE_ID = /^[\w-]{6,20}$/u;
const YOUTUBE_PATH_ID = /^\/(?:shorts|live|embed)\/(?<id>[^/]+)/u;

const youTubeIdOf = (url: URL) => {
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

export const youTubeVideoId = (value: string) => {
  const url = parseWebUrl(value);
  const id = url === null ? null : youTubeIdOf(url);

  return id !== null && YOUTUBE_ID.test(id) ? id : null;
};

export const urlKey = (value: string) => {
  const url = parseWebUrl(value);

  if (url === null) {
    return null;
  }

  const { host, path, query } = keyPartsOf(url);
  const fragment = url.hash.slice(1);

  return `${url.port === "" ? host : `${host}:${url.port}`}${path}${query === "" ? "" : `?${query}`}${isRouteFragment(fragment) ? `#${normalizeEscapes(fragment)}` : ""}`;
};

export const cleanUrl = (value: string) => {
  const url = parseWebUrl(value);

  if (url === null) {
    return null;
  }

  const host = aliasedHost(url);
  const kept = queryPieces(url).filter((piece) => piece !== "" && !isTrackingParam(piece, host));
  const search = kept.length === 0 ? "" : `?${kept.join("&")}`;

  return `${url.protocol}//${url.host}${url.pathname}${search}${url.hash}`;
};

export const urlSearchText = (value: string) => {
  const url = parseWebUrl(value);

  if (url === null) {
    return "";
  }

  const words = safeDecode(url.pathname)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");

  return [bareHost(url), ...words].join(" ");
};

const SPOTIFY_AUDIO = /^\/(?:album|episode|playlist|show|track)\//u;

const isVideo = (host: string, path: string) => {
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

const isAudio = (host: string, path: string) => {
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

export const kindForUrl = (value: string) => {
  const url = parseWebUrl(value);

  if (url === null) {
    return "link" as const;
  }

  const { host, path } = keyPartsOf(url);

  if (isVideo(host, path)) {
    return "video" as const;
  }

  return (isAudio(host, path) ? "audio" : "link") satisfies "link" | "video" | "audio";
};
