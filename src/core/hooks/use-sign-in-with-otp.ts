import useMutation from "swr/mutation";
import type { SignInWithPasswordlessCredentials } from "@supabase/gotrue-js";
import useSupabase from "~/core/hooks/use-supabase";

/**
 * @name useSignInWithOtp
 */
function useSignInWithOtp() {
  const client = useSupabase();
  const key = ["auth", "sign-in-with-otp"];

  return useMutation(
    key,
    (_, { arg: credentials }: { arg: SignInWithPasswordlessCredentials }) => {
      return client.auth.signInWithOtp(credentials).then((result) => {
        if (result.error) {
          throw result.error.message;
        }

        return result.data;
      });
    }
  );
}

export default useSignInWithOtp;
