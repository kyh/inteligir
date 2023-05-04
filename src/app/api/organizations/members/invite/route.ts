import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  throwForbiddenException,
  throwInternalServerErrorException,
} from "~/core/http-exceptions";
import getLogger from "~/core/logger";
import getSupabaseServerClient from "~/core/supabase/server-client";
import MembershipRole from "~/lib/organizations/types/membership-role";
import { parseOrganizationIdCookie } from "~/lib/server/cookies/organization.cookie";
import inviteMembers from "~/lib/server/organizations/invite-members";
import requireSession from "~/lib/user/require-session";

export async function POST(request: Request) {
  const invites = await getBodySchema().parseAsync(await request.json());

  const organizationId = Number(await parseOrganizationIdCookie(cookies()));
  const client = getSupabaseServerClient();
  const session = await requireSession(client);
  const inviterId = session.user.id;

  // throw an error when we cannot retrieve the inviter's id or the organization id
  if (!inviterId || !organizationId) {
    return throwForbiddenException(`Inviter or organization not found`);
  }

  const adminClient = getSupabaseServerClient({ admin: true });

  const params = {
    client,
    adminClient,
    invites,
    organizationId,
    inviterId,
  };

  try {
    // send requests to invite members
    await inviteMembers(params);

    return NextResponse.json({
      success: true,
    });
  } catch (e) {
    getLogger().error(e, `Error when inviting user to organization`);

    return throwInternalServerErrorException();
  }
}

function getBodySchema() {
  return z.array(
    z.object({
      role: z.nativeEnum(MembershipRole),
      email: z.string().email(),
    })
  );
}
