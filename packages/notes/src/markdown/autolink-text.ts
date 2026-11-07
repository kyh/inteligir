// A link whose bytes are its own address needs no label: its text is what a re-parse reads back as
// the same link, so the writer spells it bare, and a reader leaves its text as the address it is.

const BARE_AUTOLINK_PROTOCOL_RE = /^https?:\/\//iu;
const WWW_AUTOLINK_RE = /^www\./iu;

// mirrors micromark-extension-gfm-autolink-literal's email tokenizer, so a match emitted as raw
// bytes re-parses as the same autolink.
const GFM_EMAIL_RE = /^[+\-.\w]+@(?=[^@]*\.[\dA-Za-z])(?:[-_\dA-Za-z]|\.(?=[\dA-Za-z]))*[A-Za-z]$/u;

// text a re-parse reads back as this same link: a bare url, a www literal (gfm prefixes its url
// with `http://`), or a gfm email
export const isAutolinkText = (text: string, url: string): boolean =>
  (text === url && BARE_AUTOLINK_PROTOCOL_RE.test(url)) ||
  (url === `http://${text}` && WWW_AUTOLINK_RE.test(text)) ||
  (`mailto:${text}` === url && GFM_EMAIL_RE.test(text));

interface LinkNode {
  url?: string | undefined;
  title?: string | null | undefined;
  children?: readonly { type: string; value?: string | undefined }[] | undefined;
}

// a title has no bare spelling, so a link with one keeps its label whatever the label says
export const isBareLink = ({ children = [], title, url = "" }: LinkNode): boolean => {
  const [only, ...rest] = children;
  return (
    only?.type === "text" &&
    rest.length === 0 &&
    (title ?? "") === "" &&
    isAutolinkText(only.value ?? "", url)
  );
};
