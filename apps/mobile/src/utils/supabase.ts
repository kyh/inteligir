import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

function getSupabaseUrl(): string {
  if (process.env.EXPO_PUBLIC_SUPABASE_URL) {
    return process.env.EXPO_PUBLIC_SUPABASE_URL;
  }
  // Dev: use the same host as the Expo dev server (works on emulators + devices)
  const host = Constants.expoConfig?.hostUri?.split(":")[0] ?? "127.0.0.1";
  return `http://${host}:54321`;
}

const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(getSupabaseUrl(), SUPABASE_ANON_KEY);
