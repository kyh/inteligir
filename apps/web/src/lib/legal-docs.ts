// The docs themselves rather than copies, so a page, its markdown and the sitemap cannot say
// something docs/privacy.md or docs/terms.md does not. `?raw` is Vite's, which next.config.ts's
// Turbopack rule repeats.
import privacy from "../../../../docs/privacy.md?raw";
import terms from "../../../../docs/terms.md?raw";

export const LEGAL_DOCS = { privacy, terms };
