// The css/?url wildcard declarations are needed because desktop's tsc program
// pulls @repo/app sources in through paths mapping, without @repo/app's own
// env.d.ts (ambient files outside `include` are not loaded).
declare module "*.css";
declare module "*?url" {
  const url: string;
  export default url;
}

interface Window {
  desktopBridge?: import("@repo/features/ipc").Bridge;
}
