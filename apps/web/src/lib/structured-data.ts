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
      applicationCategory: "DeveloperApplication",
      description:
        "An open-source companion for the coding agents you already run: it shows which one needs you and lets you answer, message, start and stop it, with tmux as the control layer.",
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
