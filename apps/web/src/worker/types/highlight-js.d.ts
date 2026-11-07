// highlight.js's declarations load the DOM's lib (`/// <reference lib="dom" />`), whose globals
// (BufferSource, SubtleCrypto, BodyInit) contradict workerd's, which this program types the Worker
// against. The Worker reaches them only through types: @repo/editor's headless code block names
// @platejs/code-block, whose declarations name lowlight, which names highlight.js's grammar type;
// none of the three runs in the Worker. So the worker tsconfig's `paths` maps the package here, to
// the one type lowlight takes from it, and the bundler, which ignores `paths`, is untouched.

// what highlight.js hands a grammar's function, and the grammar it answers, as far as a type that
// nothing here calls needs them
interface HighlightApi {
  readonly versionString: string;
}

interface Language {
  readonly name?: string;
}

export type LanguageFn = (hljs: HighlightApi) => Language;
