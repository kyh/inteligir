// who the browser extension is, to Chrome and to the native host. The id is Chrome's own derivation
// from the key the manifest carries (sha256 of the DER, its first 32 hex digits mapped 0-f to a-p),
// so the dev build, the unpacked store build and the host's allowed_origins all name one extension.
// The key is the public half of an RSA-2048 key generated in this repo, whose private half was never
// kept; the owner swaps in the Web Store item's key once (docs/releasing.md). Imports nothing.

// base64 DER SubjectPublicKeyInfo
export const EXTENSION_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu0GHduwaVv8j7rtr0m1ebrepnTSPCbM6Tv/fZfsGn4Km+W3GF0t+b3NK/SzmihZI/NyLynzIAR57vh2L3vueNMAv3AML80OaHsfAUkl95cJNcZPxLwsuOk+yhAsj5S61G9o4J7XS9v+j0dJ12aHF96Peipbneeeqq5/GLGIyFP9qwOa4FjeCmziO80k5//VmW+KO+VrZdqqOg4Y+eQ+0rXTob1UxWE/gzCscRxz7EckBkXUZmg4cqDw3uZcDLkNvwVfXk8kGZ4CXz+7R4KYSrBolAXFHwxOlNFH+oRaTui3AdQN5WfkOofiKxGXecge6d2xfKVXPKgsdFhIiEdE83wIDAQAB";
export const EXTENSION_ID = "biedbnmohmigikheljajjdmhhdgnibom";
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}/`;
// the manifest name the store builds dial, which the desktop app writes for every browser
export const NATIVE_HOST_NAME = "com.inteligir.desktop";
// the dev build's, which `inteligir native-host --install` writes for a checkout
export const DEV_NATIVE_HOST_NAME = "com.inteligir.desktop.dev";
export const EXTENSION_STORE_URL = `https://chromewebstore.google.com/detail/${EXTENSION_ID}`;
