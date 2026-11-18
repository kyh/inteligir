import { JsonLd } from "#components/json-ld";
import { MarkdownPage } from "#components/markdown-page";
import { LEGAL_DOCS } from "#lib/legal-docs";
import { PAGES, statedDate } from "#lib/page-meta";
import { pageMetadata } from "#lib/page-metadata";
import { pageGraph } from "#lib/structured-data";

const dated = { dateModified: statedDate(LEGAL_DOCS.terms) };

export const metadata = pageMetadata(PAGES.terms, dated);

const TermsPage = () => (
  <>
    <JsonLd graph={pageGraph(PAGES.terms, dated)} />
    <MarkdownPage markdown={LEGAL_DOCS.terms} />
  </>
);

export default TermsPage;
