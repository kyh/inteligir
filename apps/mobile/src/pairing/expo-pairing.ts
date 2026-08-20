// The Expo wiring for pairing: the crypto primitives, the deep-link callback
// URL, and opening the approve page. Everything in here touches a native module;
// the pure handshake is pairing-manager.ts.

import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { PAIR_CALLBACK_PARAMS } from "@repo/cloud-contract/pairing";
import { z } from "zod";
import type { PkceCrypto } from "./pkce";

/** The deep-link path the approve redirect comes back through — the contract's
 *  `PAIR_CALLBACK_PATH` (`/pair/callback`) as an expo-linking segment. */
const PAIR_CALLBACK_SEGMENT = "pair/callback";

/** expo-crypto behind the injected primitives the PKCE assembly needs. */
export const expoPkceCrypto: PkceCrypto = {
  randomBytes: (length) => Crypto.getRandomBytes(length),
  sha256: async (input) =>
    new Uint8Array(
      await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new TextEncoder().encode(input)),
    ),
};

/** This app's deep-link callback, e.g. `inteligir://pair/callback` (standalone)
 *  or the `exp://…/--/pair/callback` Metro form in dev. */
export function pairCallbackUrl(): string {
  return Linking.createURL(PAIR_CALLBACK_SEGMENT);
}

/** What this device calls itself on the account by default. */
export function defaultDeviceName(): string {
  const named = Constants.deviceName;
  if (named !== undefined && named !== null && named.trim() !== "") return named;
  return Platform.OS === "ios" ? "iPhone" : "Android phone";
}

/** The `code` + `state` shape a valid callback carries. Parsed at the boundary —
 *  expo-linking hands back untyped query params (string | string[] | undefined),
 *  so a duplicated or absent param falls out here as "not a callback". */
const callbackParamsSchema = z.object({
  [PAIR_CALLBACK_PARAMS.code]: z.string().min(1),
  [PAIR_CALLBACK_PARAMS.state]: z.string().min(1),
});

/** The code + state carried on a pairing callback URL, or null when it is not
 *  one — used both by the in-session browser return and the global deep-link
 *  listener (a redirect that arrives while the app is backgrounded). */
export function parsePairCallback(url: string): { code: string; state: string } | null {
  const parsed = callbackParamsSchema.safeParse(Linking.parse(url).queryParams);
  if (!parsed.success) return null;
  return {
    code: parsed.data[PAIR_CALLBACK_PARAMS.code],
    state: parsed.data[PAIR_CALLBACK_PARAMS.state],
  };
}

/** Open the approve page and wait for the browser to redirect back to the app's
 *  callback. Returns the code + state, or null on cancel / a malformed return. */
export async function openApproveAndAwait(
  approveUrl: string,
  callbackUrl: string,
): Promise<{ code: string; state: string } | null> {
  const result = await WebBrowser.openAuthSessionAsync(approveUrl, callbackUrl);
  if (result.type !== "success") return null;
  return parsePairCallback(result.url);
}
