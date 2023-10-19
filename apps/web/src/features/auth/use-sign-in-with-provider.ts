import useMutation from "swr/mutation";
import { useSupabase } from "@/lib/supabase/use-supabase";

export const useSignInWithProvider = () => {
  const client = useSupabase();
  const key = ["auth", "sign-in-with-provider"];

  return useMutation(
    key,
    async (
      _,
      {
        arg: credentials,
      }: { arg: Parameters<typeof client.auth.signInWithOAuth>[0] },
    ) => {
      return client.auth.signInWithOAuth(credentials).then((response) => {
        if (response.error) {
          throw response.error;
        }

        return response.data;
      });
    },
  );
};
