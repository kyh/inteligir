import useMutation from "swr/mutation";
import { useSupabase } from "@/lib/supabase/use-supabase";

type Credentials = {
  email: string;
  password: string;
};

export const useSignInWithEmailPassword = () => {
  const client = useSupabase();
  const key = ["auth", "sign-in-with-email-password"];

  return useMutation(key, (_, { arg: credentials }: { arg: Credentials }) => {
    return client.auth.signInWithPassword(credentials).then((response) => {
      if (response.error) {
        throw response.error;
      }

      return response.data;
    });
  });
};
