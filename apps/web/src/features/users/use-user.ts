import useSWR from "swr";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/lib/supabase/use-supabase";

export const useUser = () => {
  const router = useRouter();
  const client = useSupabase();
  const key = "user";

  return useSWR([key], async () => {
    return client.auth
      .getUser()
      .then((result) => {
        if (result.error) {
          return Promise.reject(result.error);
        }

        return result.data.user;
      })
      .catch(() => {
        router.refresh();
      });
  });
};
