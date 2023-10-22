import useMutation from "swr/mutation";
import type { UserData } from "@/features/users/user-data";
import { useSupabase } from "@/lib/supabase/use-supabase";
import { updateUserData } from "@/features/users/mutations";

type Payload = WithId<Partial<UserData>>;

export const useUpdateProfile = () => {
  const client = useSupabase();
  const key = "useUpdateProfile";

  return useMutation(key, async (_, { arg: data }: { arg: Payload }) => {
    return updateUserData(client, data);
  });
};
