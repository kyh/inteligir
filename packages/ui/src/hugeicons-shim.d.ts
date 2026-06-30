// @hugeicons/core-free-icons ships icon DATA via deep subpaths with no .d.ts.
declare module "@hugeicons/core-free-icons/*" {
  const icon: readonly [string, Record<string, string | number>][];
  export default icon;
}
