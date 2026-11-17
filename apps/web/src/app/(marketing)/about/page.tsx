import { JsonLd } from "#components/json-ld";
import { MarkdownPage } from "#components/markdown-page";
import { PAGES } from "#lib/page-meta";
import { pageMetadata } from "#lib/page-metadata";
import { aboutMarkdown } from "#lib/site-content";
import { pageGraph } from "#lib/structured-data";

export const metadata = pageMetadata(PAGES.about);

const AboutPage = () => (
  <>
    <JsonLd graph={pageGraph(PAGES.about)} />
    <MarkdownPage markdown={aboutMarkdown} />
  </>
);

export default AboutPage;
