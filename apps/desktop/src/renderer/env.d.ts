// Ambient module declarations for the renderer UI (moved here from the former
// @repo/app package): css side-effect imports and ?url / ?raw asset imports.
declare module "*.css";
declare module "*?url" {
  const url: string;
  export default url;
}
declare module "*?raw" {
  const content: string;
  export default content;
}

interface Window {
  desktopBridge?: import("@repo/features/ipc").Bridge;
}
