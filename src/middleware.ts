import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";
import { NextResponse } from "next/server";

import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Supabase client to handle cookies
  const supabase = createMiddlewareClient({ req, res });

  // Refresh expired sessions
  await supabase.auth.getSession();

  return res;
}
