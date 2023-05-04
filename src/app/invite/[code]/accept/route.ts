import { NextResponse } from "next/server";
import { z } from "zod";
import configuration from "~/configuration";
import { throwInternalServerErrorException } from "~/core/http-exceptions";
import getLogger from "~/core/logger";
import getSupabaseServerClient from "~/core/supabase/server-client";
import { acceptInviteToOrganization } from "~/lib/memberships/mutations";
import { createOrganizationIdCookie } from "~/lib/server/cookies/organization.cookie";

interface Context {
  params: {
    code: string;
  };
}

export async function POST(request: Request, { params }: Context) {
  const code = params.code;

  const logger = getLogger();
  const adminClient = getSupabaseServerClient({ admin: true });

  // if the user ID is provided, we use it
  // (for example, when signing up for the 1st time)
  let userId = getBodySchema().parse(request.body).userId;
  let signedIn = false;

  // if the user ID is not provided, we try to get it from the session
  if (!userId) {
    const { data } = await adminClient.auth.getSession();

    // if the session is not available, we throw an error
    if (!data.session) {
      return throwInternalServerErrorException();
    }

    userId = data.session.user.id;
    signedIn = true;
  }

  logger.info(
    {
      code,
      userId,
    },
    `Adding member to organization...`
  );

  try {
    const { data, error } = await acceptInviteToOrganization(adminClient, {
      code,
      userId,
    });

    if (error) {
      return handleError({ error, code, userId });
    }

    const result = data as { organization: number; membership: number };
    const organizationId = result.organization;
    const membershipId = result.membership;

    logger.info(
      {
        membershipId,
        organizationId,
        userId,
      },
      `Member successfully added to organization`
    );

    const organizationCookie = createOrganizationIdCookie(organizationId);
    const cookies = new NextResponse().cookies.set(organizationCookie);

    const verifyEmail =
      configuration.auth.requireEmailConfirmation && !signedIn;

    return NextResponse.json(
      {
        verifyEmail,
      },
      {
        status: 200,
        headers: {
          "Set-Cookie": cookies.toString(),
        },
      }
    );
  } catch (error) {
    return handleError({ error, code, userId });
  }
}

function handleError(params: { error: unknown; code: string; userId: string }) {
  getLogger().error(params, `Encountered an error while accepting invite`);

  return throwInternalServerErrorException();
}

function getBodySchema() {
  return z.object({
    userId: z.string().uuid().optional(),
  });
}
