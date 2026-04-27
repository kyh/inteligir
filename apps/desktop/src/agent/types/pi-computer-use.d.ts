// Type-check shim for @injaneity/pi-computer-use's raw .ts entry point.
//
// The package ships unbuilt TypeScript source (no dist/, no .d.ts), and
// importing it directly causes tsc to type-check the entire package — which
// uses .ts-suffixed imports throughout and contains a stray unused local in
// bridge.ts. Rather than relaxing tsc options project-wide, we redirect tsc's
// resolution of this specifier to this declaration via tsconfig `paths`.
//
// esbuild (electron-vite) is unaffected: it uses `resolve.alias` from
// electron.vite.config.ts and ignores tsconfig `paths`, so at bundle time it
// still resolves to the real package and inlines the implementation.

declare const computerUseExtension: (
  pi: import("@mariozechner/pi-coding-agent").ExtensionAPI,
) => void;

export default computerUseExtension;
