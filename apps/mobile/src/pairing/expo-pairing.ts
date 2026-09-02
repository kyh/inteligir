import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import type { PairCallback } from "@repo/api/cloud/pairing/pairing-flow";
import {
  PAIR_CALLBACK_PARAMS,
  PAIR_MOBILE_REDIRECT_SEGMENT,
  type PkceCrypto,
} from "@repo/api/cloud/pairing/pairing-schema";
import { z } from "zod";

export const expoPkceCrypto: PkceCrypto = {
  randomBytes: (length) => Crypto.getRandomBytes(length),
  sha256: async (input) =>
    new Uint8Array(
      await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new TextEncoder().encode(input)),
    ),
};

export function pairCallbackUrl(): string {
  return Linking.createURL(PAIR_MOBILE_REDIRECT_SEGMENT);
}

export function defaultDeviceName(): string {
  const named = Constants.deviceName;
  if (named !== undefined && named !== null && named.trim() !== "") return named;
  return Platform.OS === "ios" ? "iPhone" : "Android phone";
}

const callbackParamsSchema = z.object({
  [PAIR_CALLBACK_PARAMS.code]: z.string().min(1),
  [PAIR_CALLBACK_PARAMS.state]: z.string().min(1),
});

export function parsePairCallback(url: string): PairCallback | null {
  const parsed = callbackParamsSchema.safeParse(Linking.parse(url).queryParams);
  if (!parsed.success) return null;
  return {
    code: parsed.data[PAIR_CALLBACK_PARAMS.code],
    state: parsed.data[PAIR_CALLBACK_PARAMS.state],
  };
}

export async function openApproveAndAwait(
  approveUrl: string,
  callbackUrl: string,
): Promise<PairCallback | null> {
  const result = await WebBrowser.openAuthSessionAsync(approveUrl, callbackUrl);
  if (result.type !== "success") return null;
  return parsePairCallback(result.url);
}
