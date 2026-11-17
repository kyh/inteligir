import { JsonLd } from "#components/json-ld";
import { MarkdownPage } from "#components/markdown-page";
import { PAGES } from "#lib/page-meta";
import { pageMetadata } from "#lib/page-metadata";
import { contactMarkdown } from "#lib/site-content";
import { pageGraph } from "#lib/structured-data";

export const metadata = pageMetadata(PAGES.contact);

const ContactPage = () => (
  <>
    <JsonLd graph={pageGraph(PAGES.contact)} />
    <MarkdownPage markdown={contactMarkdown} />
  </>
);

export default ContactPage;
