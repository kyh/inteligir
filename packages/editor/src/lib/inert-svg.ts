// A drawing's markup becomes nodes only through here. Pele escapes a diagram's text and filters
// its links and styles already; this keeps the guarantee local, so a renderer bug can neither run
// code nor fetch anything (NOTHING REMOTE LOADS IN A NOTE, apps/cli/CLAUDE.md). XML parsing builds
// inert nodes in a document of their own, and every element outside the svg namespace, and every
// element or attribute that could run a script or reach outside the drawing, is taken out before
// the nodes are adopted.

const SVG_NS = "http://www.w3.org/2000/svg";

// an element of another namespace (an html island anywhere, its src, srcset, data and content
// with it) is taken out whole, and so are these of the drawing's own: a script, an html island, a
// stylesheet that could @import, and the animations that can rewrite an href after this pass has run
const REFUSED_ELEMENTS = new Set([
  "animate",
  "animateMotion",
  "animateTransform",
  "foreignObject",
  "script",
  "set",
  "style",
]);

// a url() that names anything but a fragment of the drawing itself
const OUTSIDE_URL = /url\(\s*(?!['"]?#)/iu;

const refusedAttribute = (attribute: Attr): boolean =>
  attribute.localName.toLowerCase().startsWith("on") ||
  (attribute.localName === "href" && !attribute.value.trim().startsWith("#")) ||
  OUTSIDE_URL.test(attribute.value);

// null when the markup is not one well-formed <svg>, so the caller draws nothing rather than a
// parser's error page
export const inertSvg = (markup: string): Element | null => {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = parsed.documentElement;
  if (
    root.namespaceURI !== SVG_NS ||
    root.localName !== "svg" ||
    parsed.querySelectorAll("parsererror").length > 0
  ) {
    return null;
  }
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (element.namespaceURI !== SVG_NS || REFUSED_ELEMENTS.has(element.localName)) {
      element.remove();
      continue;
    }
    // the names are a copy, where `attributes` is live and skips the one after each removal
    for (const name of element.getAttributeNames()) {
      const attribute = element.getAttributeNode(name);
      if (attribute !== null && refusedAttribute(attribute)) {
        element.removeAttributeNode(attribute);
      }
    }
  }
  return document.importNode(root, true);
};
