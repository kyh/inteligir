// A url's one key, computed without the platform's URL: React Native's is not WHATWG, so the phone
// and the Mac would key one link differently. Import-free, and every rule here is projected
// (`urlKey` lands in the index), so a change to one bumps PROJECTION_VERSION.

// RFC 3986 appendix B, read as a web address: the scheme and authority are required below
const URI_RE =
  /^(?:(?<scheme>[^:/?#]+):)?(?:\/\/(?<authority>[^/?#]*))?(?<path>[^?#]*)(?:\?(?<query>[^#]*))?(?:#(?<fragment>.*))?$/su;

const WEB_SCHEMES = new Set(["http", "https"]);

interface WebUrl {
  // as written
  scheme: string;
  // as written, IPv6 brackets kept
  host: string;
  // the digits as written; null when there are none
  port: string | null;
  path: string;
  query: string | null;
  fragment: string | null;
}

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

const DIGITS = /^\d*$/u;

const splitHostPort = (hostPort: string): { host: string; port: string | null } | null => {
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    if (close === -1) {
      return null;
    }
    const rest = hostPort.slice(close + 1);
    if (rest !== "" && !rest.startsWith(":")) {
      return null;
    }
    const port = rest.slice(1);
    return DIGITS.test(port)
      ? { host: hostPort.slice(0, close + 1), port: port === "" ? null : port }
      : null;
  }
  const colon = hostPort.lastIndexOf(":");
  const host = colon === -1 ? hostPort : hostPort.slice(0, colon);
  const port = colon === -1 ? "" : hostPort.slice(colon + 1);
  if (!DIGITS.test(port) || host.includes("[") || host.includes("]")) {
    return null;
  }
  return { host, port: port === "" ? null : port };
};

const parseWebUrl = (value: string): WebUrl | null => {
  const trimmed = value.trim();
  if (trimmed === "" || holdsSpaceOrControl(trimmed)) {
    return null;
  }
  const groups = URI_RE.exec(trimmed)?.groups;
  const scheme = groups?.["scheme"];
  const authority = groups?.["authority"];
  if (
    groups === undefined ||
    scheme === undefined ||
    authority === undefined ||
    !WEB_SCHEMES.has(scheme.toLowerCase())
  ) {
    return null;
  }
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  const split = splitHostPort(hostPort);
  if (split === null || split.host.replace(/\.$/u, "") === "") {
    return null;
  }
  return {
    fragment: groups["fragment"] ?? null,
    host: split.host,
    path: groups["path"] ?? "",
    port: split.port,
    query: groups["query"] ?? null,
    scheme,
  };
};

export const isWebUrl = (value: string): boolean => parseWebUrl(value) !== null;

const bareHost = (url: WebUrl): string =>
  url.host
    .toLowerCase()
    .replace(/\.$/u, "")
    .replace(/^www\./u, "");

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
const aliasedHost = (url: WebUrl): string => {
  const host = bareHost(url);
  if (host === SHORT_YOUTUBE_HOST) {
    return "youtube.com";
  }
  const lang = MOBILE_WIKIPEDIA.exec(host)?.groups?.["lang"];
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

const UNRESERVED = /^[\w.~-]$/u;
const HEX_PAIR = /^[\dA-Fa-f]{2}$/u;
const REPLACEMENT_CHAR = 0xff_fd;
const MAX_BMP = 0xff_ff;

const escapeByte = (byte: number): string => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;

// one code point's UTF-8 bytes as escapes; a lone surrogate is the replacement character's
/* oxlint-disable no-bitwise -- UTF-8 is bit packing: the shifts and masks ARE the encoding */
const utf8Escapes = (codePoint: number): string => {
  const cp = codePoint >= 0xd8_00 && codePoint <= 0xdf_ff ? REPLACEMENT_CHAR : codePoint;
  if (cp <= 0x7_ff) {
    return escapeByte(0xc0 | (cp >> 6)) + escapeByte(0x80 | (cp & 0x3f));
  }
  if (cp <= MAX_BMP) {
    return (
      escapeByte(0xe0 | (cp >> 12)) +
      escapeByte(0x80 | ((cp >> 6) & 0x3f)) +
      escapeByte(0x80 | (cp & 0x3f))
    );
  }
  return (
    escapeByte(0xf0 | (cp >> 18)) +
    escapeByte(0x80 | ((cp >> 12) & 0x3f)) +
    escapeByte(0x80 | ((cp >> 6) & 0x3f)) +
    escapeByte(0x80 | (cp & 0x3f))
  );
};
/* oxlint-enable no-bitwise */

// escapes uppercased, an unreserved one decoded, non-ASCII escaped as UTF-8
const normalizeEscapes = (text: string): string => {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const pair = text.slice(i + 1, i + 3);
    if (text[i] === "%" && HEX_PAIR.test(pair)) {
      const hex = pair.toUpperCase();
      const decoded = String.fromCodePoint(Number.parseInt(hex, 16));
      out += UNRESERVED.test(decoded) ? decoded : `%${hex}`;
      i += 3;
      continue;
    }
    const cp = text.codePointAt(i) ?? 0;
    const width = cp > MAX_BMP ? 2 : 1;
    out += cp > 0x7f ? utf8Escapes(cp) : text.slice(i, i + width);
    i += width;
  }
  return out;
};

// RFC 3986 § 5.2.4 over a path that starts with `/` or is empty
const removeDotSegments = (path: string): string => {
  const segments = path.split("/");
  const out: string[] = [];
  for (const [i, segment] of segments.entries()) {
    const last = i === segments.length - 1;
    if (segment === "." || segment === "..") {
      if (segment === ".." && out.length > 1) {
        out.pop();
      }
      if (last) {
        out.push("");
      }
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
};

const keyPath = (path: string): string => {
  const clean = removeDotSegments(normalizeEscapes(path));
  if (clean === "" || clean === "/") {
    return "/";
  }
  return clean.endsWith("/") ? clean.slice(0, -1) : clean;
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

const DEFAULT_PORTS = new Set(["80", "443"]);

// a route fragment (`#/inbox`, `#!/post`) addresses a different page; any other is a place in it
const isRouteFragment = (fragment: string): boolean =>
  fragment.startsWith("/") || fragment.startsWith("!");

interface UrlKeyParts {
  host: string;
  path: string;
  query: string;
}

const keyPartsOf = (url: WebUrl): UrlKeyParts => {
  const host = aliasedHost(url);
  const pieces = url.query === null ? [] : url.query.split("&");
  if (bareHost(url) === SHORT_YOUTUBE_HOST) {
    const id = normalizeEscapes(firstSegment(url.path));
    return {
      host,
      path: id === "" ? "/" : "/watch",
      query: keyQuery(id === "" ? pieces : [...pieces, `v=${id}`], host),
    };
  }
  return { host, path: keyPath(url.path), query: keyQuery(pieces, host) };
};

// an address's last path segment, decoded ("" when it names none, or one that does not decode)
export const urlLastSegment = (value: string): string => {
  const url = parseWebUrl(value);
  const segment = url?.path.split("/").findLast((part) => part !== "") ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
};

const YOUTUBE_ID = /^[\w-]{6,20}$/u;
const YOUTUBE_PATH_ID = /^\/(?:shorts|live|embed)\/(?<id>[^/?#]+)/u;

const decodedOrNull = (text: string): string | null => {
  try {
    return decodeURIComponent(text.replaceAll("+", " "));
  } catch {
    return null;
  }
};

// a query's first value for `name`, decoded; null when it has none
const queryValue = (query: string | null, name: string): string | null => {
  for (const piece of query?.split("&") ?? []) {
    const eq = piece.indexOf("=");
    if (eq !== -1 && decodedOrNull(piece.slice(0, eq)) === name) {
      return decodedOrNull(piece.slice(eq + 1));
    }
  }
  return null;
};

// a YouTube video's id, from any of its addresses (a watch page, a short link, a short, a live, an
// embed); null for any other address
export const youTubeVideoId = (value: string): string | null => {
  const url = parseWebUrl(value);
  if (url === null) {
    return null;
  }
  const host = bareHost(url);
  let id: string | null = null;
  if (host === SHORT_YOUTUBE_HOST) {
    id = decodedOrNull(firstSegment(url.path));
  } else if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    const fromPath = YOUTUBE_PATH_ID.exec(url.path)?.groups?.["id"];
    id = queryValue(url.query, "v") ?? (fromPath === undefined ? null : decodedOrNull(fromPath));
  }
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
  const port = url.port === null ? null : String(Number(url.port));
  const hostPort = port === null || DEFAULT_PORTS.has(port) ? host : `${host}:${port}`;
  const fragment =
    url.fragment !== null && isRouteFragment(url.fragment)
      ? `#${normalizeEscapes(url.fragment)}`
      : "";
  return `${hostPort}${path}${query === "" ? "" : `?${query}`}${fragment}`;
};

// what is written to `url:`: the address as given, less its userinfo and its tracking parameters
export const cleanUrl = (value: string): string | null => {
  const url = parseWebUrl(value);
  if (url === null) {
    return null;
  }
  let { query } = url;
  if (query !== null) {
    const host = aliasedHost(url);
    const pieces = query.split("&");
    const kept = pieces.filter((piece) => piece === "" || !isTrackingParam(piece, host));
    if (kept.length !== pieces.length) {
      const joined = kept.filter((piece) => piece !== "").join("&");
      query = joined === "" ? null : joined;
    }
  }
  return (
    `${url.scheme}://${url.host}${url.port === null ? "" : `:${url.port}`}${url.path}` +
    `${query === null ? "" : `?${query}`}${url.fragment === null ? "" : `#${url.fragment}`}`
  );
};

const safeDecode = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

// the host and the path's words, for the search index's meta column
export const urlSearchText = (value: string): string => {
  const url = parseWebUrl(value);
  if (url === null) {
    return "";
  }
  const words = safeDecode(url.path)
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
