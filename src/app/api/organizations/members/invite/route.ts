import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";

import { z } from "zod";

import { parseOrganizationIdCookie } from "~/lib/server/cookies/organization.cookie";
import getSupabaseServerClient from "~/core/supabase/server-client";
import requireSession from "~/lib/user/require-session";

import {
  throwForbiddenException,
  throwInternalServerErrorException,
} from "~/core/http-exceptions";

import getLogger from "~/core/logger";

import inviteMembers from "~/lib/server/organizations/invite-members";
import MembershipRole from "~/lib/organizations/types/membership-role";

export async function POST(request: Request) {
  const invites = await getBodySchema().parseAsync(await request.json());

  const organizationId = Number(await parseOrganizationIdCookie(cookies()));
  const client = getSupabaseServerClient();
  const sessionResult = await requireSession(client);

  if ("redirect" in sessionResult) {
    return redirect(sessionResult.destination);
  }

  const inviterId = sessionResult.user.id;

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
