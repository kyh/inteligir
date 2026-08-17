// The delegation anchor's on-disk grammar, in one place: an HTML comment on
// its own line — invisible in any other markdown renderer, round-trip-inert,
// and greppable. The payload is a client-minted ANCHOR token rather than the
// thread id, because a thread id does not exist until the create call
// returns and the create binds (doc, anchor) atomically — the thread's
// `originAnchor` column holds the same token, which is how a chip resolves
// its thread. Every surface that writes, finds or deletes a marker goes
// through these functions, so no surface can accept a marker another
// surface refuses.

const ANCHOR_TOKEN_RE = /^[A-Za-z0-9_-]+$/u;

const MARKER_RE = /<!-- inteligir:thread ([A-Za-z0-9_-]+) -->/gu;

export function isThreadAnchorToken(value: string): boolean {
  return ANCHOR_TOKEN_RE.test(value);
}

export function threadMarkerText(anchor: string): string {
  if (!isThreadAnchorToken(anchor)) {
    throw new Error(`Not a thread anchor token: ${anchor}`);
  }
  return `<!-- inteligir:thread ${anchor} -->`;
}

export interface ThreadMarker {
  anchor: string;
  /** Offsets of the marker text itself (terminators excluded). */
  from: number;
  to: number;
}

export function findThreadMarkers(content: string): ThreadMarker[] {
  const markers: ThreadMarker[] = [];
  for (const match of content.matchAll(MARKER_RE)) {
    const anchor = match[1];
    if (anchor === undefined) {
      continue;
    }
    markers.push({ anchor, from: match.index, to: match.index + match[0].length });
  }
  return markers;
}

export interface ThreadMarkerInsertion {
  /** Offset the insert text goes in AT (a plain splice; nothing is replaced). */
  at: number;
  text: string;
}

/**
 * Where a new marker lands: on its own line, immediately below the line
 * containing `offset` — the block boundary of the delegated block. Expressed
 * over the string so the editor buffer and a server-side splice share one
 * rule; the editor dispatches `{from: at, insert: text}`, a string caller
 * splices.
 */
export function threadMarkerInsertion(
  content: string,
  offset: number,
  anchor: string,
): ThreadMarkerInsertion {
  const bounded = Math.max(0, Math.min(offset, content.length));
  const lineBreak = content.indexOf("\n", bounded);
  const lineEnd = lineBreak === -1 ? content.length : lineBreak;
  return { at: lineEnd, text: `\n${threadMarkerText(anchor)}` };
}

export function insertThreadMarker(content: string, offset: number, anchor: string): string {
  const insertion = threadMarkerInsertion(content, offset, anchor);
  return content.slice(0, insertion.at) + insertion.text + content.slice(insertion.at);
}

export interface ThreadMarkerRemoval {
  from: number;
  to: number;
}

/**
 * The deletion range for a marker: the marker text plus ONE adjacent line
 * terminator (the one insertion added), so a dismiss reverses an insert
 * byte-exactly instead of leaving a blank line behind. A marker sharing its
 * line with other text loses only the marker bytes.
 */
export function threadMarkerRemoval(content: string, marker: ThreadMarker): ThreadMarkerRemoval {
  const lineStart = content.lastIndexOf("\n", marker.from - 1) + 1;
  const lineBreak = content.indexOf("\n", marker.to);
  const lineEnd = lineBreak === -1 ? content.length : lineBreak;
  const alone =
    content.slice(lineStart, marker.from).trim() === "" &&
    content.slice(marker.to, lineEnd).trim() === "";
  if (!alone) {
    return { from: marker.from, to: marker.to };
  }
  if (lineStart > 0) {
    return { from: lineStart - 1, to: lineEnd };
  }
  return { from: lineStart, to: lineEnd === content.length ? lineEnd : lineEnd + 1 };
}
