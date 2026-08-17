// The bundler turns a `.css` import into a side effect (a stylesheet link, or
// an inlined <style>); TypeScript needs to be told the module exists at all.
// Only third-party stylesheets are imported this way — the house look is a
// CodeMirror theme, so the app's appearance system can drive it.
declare module "*.css";
