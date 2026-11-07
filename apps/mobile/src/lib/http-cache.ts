// iOS keeps what a fetch reads in a cache of its own, in the app's Caches folder, with the request's
// headers beside it. What a sign-out takes from the phone goes from there too.
// The native half is modules/http-cache, linked on iOS alone because the phone ships for iPhone
// only.

import { requireNativeModule } from "expo";

interface HttpCacheModule {
  clear: () => Promise<void>;
}

export const clearHttpCache = async (): Promise<void> => {
  await requireNativeModule<HttpCacheModule>("HttpCache").clear();
};
