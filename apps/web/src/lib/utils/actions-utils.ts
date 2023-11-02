import { notFound } from "next/navigation";
import { requireSession } from "@/features/auth/require-session";
import { getSupabaseServerActionClient } from "@/lib/supabase/action-client";
import isUserSuperAdmin from "@/features/auth/is-user-super-admin";

export const withSession =
  <Args extends any[], Response>(fn: (...params: Args) => Response) =>
  async (...params: Args) => {
    const client = getSupabaseServerActionClient();

    await requireSession(client);

    return fn(...params);
  };

export const withAdminSession =
  <Args extends any[], Response>(fn: (...params: Args) => Response) =>
  async (...params: Args) => {
    const isAdmin = await isUserSuperAdmin();

    if (!isAdmin) {
      notFound();
    }

    return fn(...params);
  };
