import { expoClient } from "@better-auth/expo";
import * as SecureStore from "expo-secure-store";
import { createAuthClient } from "better-auth/react";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    expoClient({
      scheme: "inteligir",
      storagePrefix: "inteligir",
      storage: SecureStore,
    }),
  ],
});

export const { useSession, signIn, signUp, signOut } = authClient;
