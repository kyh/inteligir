// the native host this build dials: the dev build the manifest `inteligir native-host --install`
// writes for a checkout, a store build the one the desktop app writes. The build defines it
// (vite.config.ts), so nothing at run time chooses it.
export const nativeHostName = (): string => __INTELIGIR_NATIVE_HOST__;
