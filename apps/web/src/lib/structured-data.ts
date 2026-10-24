import type { PageMeta } from "@/lib/page-meta";
import { HOME_VIDEO } from "@/lib/page-meta";
import { siteConfig } from "@/lib/site-config";

const { contact, description, downloadUrl, github, name, twitterUrl, url } = siteConfig;

const ORGANIZATION_ID = `${url}/#organization`;
const WEBSITE_ID = `${url}/#website`;
const APP_ID = `${url}/#app`;

// no postal address or phone: the project publishes neither, so the org schema stays partial
export const siteGraph = () => ({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@id": ORGANIZATION_ID,
      "@type": "Organization",
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: contact.email,
        url: `${url}/contact`,
      },
      founder: { "@type": "Person", name: "Kaiyu Hsu", sameAs: [twitterUrl] },
      logo: `${url}/favicon/web-app-manifest-512x512.png`,
      name,
      sameAs: [github, twitterUrl],
      url,
    },
    {
      "@id": WEBSITE_ID,
      "@type": "WebSite",
      description,
      name,
      publisher: { "@id": ORGANIZATION_ID },
      url,
    },
    {
      "@id": APP_ID,
      "@type": "SoftwareApplication",
      applicationCategory: "ProductivityApplication",
      description:
        "A local-first notes app for the Mac in which an AI agent, running on your own Claude or ChatGPT plan, edits your markdown notes with you.",
      downloadUrl,
      license: "https://opensource.org/licenses/MIT",
      name,
      operatingSystem: "macOS (Apple silicon)",
      publisher: { "@id": ORGANIZATION_ID },
      sameAs: [github],
      url,
    },
  ],
});

const PAGE_TYPE = {
  about: "AboutPage",
  contact: "ContactPage",
  home: "WebPage",
  legal: "WebPage",
} as const satisfies Record<PageMeta["kind"], string>;

const absolute = (path: string): string => `${url}${path === "/" ? "" : path}`;

const homeVideoObject = () => ({
  "@id": `${url}/#video`,
  "@type": "VideoObject",
  contentUrl: absolute(HOME_VIDEO.path),
  description: HOME_VIDEO.description,
  duration: HOME_VIDEO.duration,
  height: HOME_VIDEO.height,
  name: HOME_VIDEO.name,
  thumbnailUrl: absolute(HOME_VIDEO.poster),
  uploadDate: HOME_VIDEO.uploadDate,
  width: HOME_VIDEO.width,
});

/** The page's own node and its breadcrumb, beside the site-wide graph the root document carries. */
export const pageGraph = (page: PageMeta, options: { dateModified?: string } = {}) => {
  const pageUrl = absolute(page.path);
  const isHome = page.kind === "home";
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@id": `${pageUrl}#webpage`,
        "@type": PAGE_TYPE[page.kind],
        // JSON drops an undefined field, so a page without one simply omits it
        about: isHome ? { "@id": APP_ID } : undefined,
        breadcrumb: { "@id": `${pageUrl}#breadcrumb` },
        dateModified: options.dateModified,
        description: page.description,
        inLanguage: "en-US",
        isPartOf: { "@id": WEBSITE_ID },
        name: isHome ? `${name}: ${page.title}` : `${page.title} · ${name}`,
        primaryImageOfPage: {
          "@type": "ImageObject",
          caption: page.image.alt,
          height: page.image.height,
          url: absolute(page.image.path),
          width: page.image.width,
        },
        url: pageUrl,
        video: isHome ? homeVideoObject() : undefined,
      },
      {
        "@id": `${pageUrl}#breadcrumb`,
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", item: url, name, position: 1 },
          ...(isHome
            ? []
            : [{ "@type": "ListItem", item: pageUrl, name: page.title, position: 2 }]),
        ],
      },
    ],
  };
};

// `<` escaped so no string in the graph can close the inline <script> it is embedded in
type JsonLdGraph = ReturnType<typeof siteGraph> | ReturnType<typeof pageGraph>;

export const serializeJsonLd = (graph: JsonLdGraph): string =>
  JSON.stringify(graph).replaceAll("<", String.raw`\u003c`);
