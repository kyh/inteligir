import { redirect } from "next/navigation";
import { getSession, getOrganization } from "@repo/api/auth/auth";

export async function GET() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  // Get the active organization
  if (session.session.activeOrganizationId) {
    const org = await getOrganization({
      organizationId: session.session.activeOrganizationId,
    });
    if (org?.slug) {
      redirect(`/dashboard/${org.slug}`);
    }
  }

  // Fallback - shouldn't happen if org creation works
  redirect("/login");
}
