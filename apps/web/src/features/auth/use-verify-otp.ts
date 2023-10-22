import useMutation from "swr/mutation";
import { useSupabase } from "@/lib/supabase/use-supabase";

export const useVerifyOtp = () => {
  const client = useSupabase();

  return useMutation(
    ["verify-otp"],
    async (
      _,
      { arg }: { arg: Parameters<typeof client.auth.verifyOtp>[0] },
    ) => {
      const { data, error } = await client.auth.verifyOtp(arg);

      if (error) {
        throw error;
      }

      return data;
    },
  );
};
