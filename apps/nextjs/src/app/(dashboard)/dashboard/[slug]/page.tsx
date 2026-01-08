import { redirect } from "next/navigation";
import { getSession } from "@repo/api/auth/auth";

import { Home } from "./home";

export default async function OrgPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return <Home />;
}
