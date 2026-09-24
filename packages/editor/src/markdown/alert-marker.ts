// GitHub's alert grammar, spelled once: the renderer, the serializer and turn-into all read a
// quote through it, because any two that disagree on `> [!note]` render an alert the save
// escapes to `\[!note]`. The variant matches in any case; the bytes keep the case written.

export const ALERT_VARIANTS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;

export type AlertVariant = (typeof ALERT_VARIANTS)[number];

const VARIANT_GROUP = `(?<variant>${ALERT_VARIANTS.join("|")})`;

// strict: the marker is the whole first line, and the match spans its soft break too.
const ALERT_LINE_RE = new RegExp(String.raw`^\[!${VARIANT_GROUP}\](?:\n|$)`, "iu");

// loose: the marker leads the text, whatever follows; the match spans one space or break after it.
const ALERT_LEAD_RE = new RegExp(String.raw`^\s*\[!${VARIANT_GROUP}\]\s?`, "iu");

export const parseAlertVariant = (raw: string): AlertVariant | null => {
  const upper = raw.toUpperCase();
  return ALERT_VARIANTS.find((variant) => variant === upper) ?? null;
};

const matchMarker = (
  re: RegExp,
  text: string,
): { length: number; variant: AlertVariant } | null => {
  const match = re.exec(text);
  const variant = match ? parseAlertVariant(match.groups?.variant ?? "") : null;
  return match && variant ? { length: match[0].length, variant } : null;
};

// `hidden` is what the live editor may hide behind the badge: every byte of the marker line.
export const alertMarkerPrefix = (
  text: string,
): { hidden: number; variant: AlertVariant } | null => {
  const marker = matchMarker(ALERT_LINE_RE, text);
  return marker ? { hidden: marker.length, variant: marker.variant } : null;
};

// Any alert, its marker alone on the line or followed by prose. `end` is the offset past the
// marker and the one space or break after it: what dropping the alert removes.
export const leadingAlertMarker = (text: string): { end: number; variant: AlertVariant } | null => {
  const marker = matchMarker(ALERT_LEAD_RE, text);
  return marker ? { end: marker.length, variant: marker.variant } : null;
};
