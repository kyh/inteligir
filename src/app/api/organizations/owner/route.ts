import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  throwBadRequestException,
  throwForbiddenException,
  throwInternalServerErrorException,
} from "~/core/http-exceptions";
import getLogger from "~/core/logger";
import getSupabaseServerClient from "~/core/supabase/server-client";
import { transferOwnership } from "~/lib/memberships/mutations";
import { parseOrganizationIdCookie } from "~/lib/server/cookies/organization.cookie";
import { getUserDataById } from "~/lib/server/queries";
import requireSession from "~/lib/user/require-session";

export async function PUT(req: Request) {
  const result = await getBodySchema().safeParseAsync(await req.json());

  // validate the form data
  if (!result.success) {
    throw throwBadRequestException();
  }

  const logger = getLogger();
  const client = getSupabaseServerClient();

  const organizationId = Number(await parseOrganizationIdCookie(cookies()));

  const targetUserMembershipId = result.data.membershipId;
  const session = await requireSession(client);

  const currentUserId = session.user.id;
  const currentUser = await getUserDataById(client, currentUserId);

  logger.info(
    {
      organizationId,
      currentUserId,
      targetUserMembershipId,
    },
    `Transferring organization ownership`
  );

  // return early if we can't get the current user
  if (!currentUser) {
    return throwForbiddenException(`User is not logged in or does not exist`);
  }

  // transfer ownership to the target user
  const { error } = await transferOwnership(client, {
    organizationId,
    targetUserMembershipId,
  });

  if (error) {
    logger.error(
      {
        error,
        organizationId,
        currentUserId,
        targetUserMembershipId,
      },
      `Error transferring organization ownership`
    );

    return throwInternalServerErrorException(`Error transferring ownership`);
  }

  // all done! we log the result and return a 200
  logger.info(
    {
      organizationId,
      currentUserId,
      targetUserMembershipId,
    },
    `Ownership successfully transferred to target user`
  );

  return NextResponse.json({ success: true });
}

function getBodySchema() {
  return z.object({
    membershipId: z.coerce.number(),
  });
}
