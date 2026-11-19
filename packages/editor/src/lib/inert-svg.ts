const SVG_NS = "http://www.w3.org/2000/svg";

const REFUSED_ELEMENTS = new Set([
  "animate",
  "animateMotion",
  "animateTransform",
  "foreignObject",
  "script",
  "set",
  "style",
]);

const OUTSIDE_URL = /url\(\s*(?!['"]?#)/iu;

const refusedAttribute = (attribute: Attr) =>
  attribute.localName.toLowerCase().startsWith("on") ||
  (attribute.localName === "href" && !attribute.value.trim().startsWith("#")) ||
  OUTSIDE_URL.test(attribute.value);

export const inertSvg = (markup: string) => {
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

    for (const name of element.getAttributeNames()) {
      const attribute = element.getAttributeNode(name);

      if (attribute !== null && refusedAttribute(attribute)) {
        element.removeAttributeNode(attribute);
      }
    }
  }

  return document.importNode(root, true);
};
