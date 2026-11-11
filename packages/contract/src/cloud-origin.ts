// what a client talks to when nothing names another origin; a second spelling in either client is
// how one of them ends up signing in somewhere the other does not.
export const PRODUCTION_CLOUD_ORIGIN = "https://inteligir.com";

// the origin the phone's requests name in `expo-origin`, its app scheme's (`apps/mobile/app.config.js`):
// Better Auth trusts it for the phone's sign-in, and `/v1` reads the phone's cookie under it
export const PHONE_ORIGIN = "inteligir://";
