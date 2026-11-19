import { JsonLd } from "#components/json-ld";
import { MarkdownPage } from "#components/markdown-page";
import { LEGAL_DOCS } from "#lib/legal-docs";
import { PAGES, statedDate } from "#lib/page-meta";
import { pageMetadata } from "#lib/page-metadata";
import { pageGraph } from "#lib/structured-data";

const dated = { dateModified: statedDate(LEGAL_DOCS.privacy) };

export const metadata = pageMetadata(PAGES.privacy, dated);

const PrivacyPage = () => (
  <>
    <JsonLd graph={pageGraph(PAGES.privacy, dated)} />
    <MarkdownPage markdown={LEGAL_DOCS.privacy} />
  </>
);

export default PrivacyPage;
