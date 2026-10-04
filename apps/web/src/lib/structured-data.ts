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

// `<` escaped so no string in the graph can close the inline <script> it is embedded in
export const serializeJsonLd = (graph: ReturnType<typeof siteGraph>): string =>
  JSON.stringify(graph).replaceAll("<", String.raw`\u003c`);
