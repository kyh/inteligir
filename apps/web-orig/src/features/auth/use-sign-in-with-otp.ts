import useMutation from "swr/mutation";
import { useSupabase } from "@/lib/supabase/use-supabase";

export const useSignInWithOtp = () => {
  const client = useSupabase();
  const key = ["auth", "sign-in-with-otp"];

  return useMutation(
    key,
    (
      _,
      {
        arg: credentials,
      }: { arg: Parameters<typeof client.auth.signInWithOtp>[0] },
    ) => {
      return client.auth.signInWithOtp(credentials).then((result) => {
        if (result.error) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `Ignoring error during development: ${result.error.message}`,
            );

            return {};
          }

          throw result.error;
        }

        return result.data;
      });
    },
  );
};
