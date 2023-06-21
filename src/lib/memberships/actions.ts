"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { siteConfig } from "~/config/site";
import { z } from "zod";
import type { DatabaseClient } from "~/core/db";
import { withCsrfCheck, withSession } from "~/core/generic/actions-utils";
import getLogger from "~/core/logger";
import getSupabaseServerActionClient from "~/core/supabase/action-client";
import {
  acceptInviteToOrganization,
  deleteMembershipById,
  updateMembershipById,
} from "~/lib/memberships/mutations";
import { getOrganizationById } from "~/lib/organizations/queries";
import MembershipRole from "~/lib/organizations/types/membership-role";
import { createOrganizationIdCookie } from "~/lib/server/cookies/organization.cookie";

export const updateMemberAction = withCsrfCheck(
  withSession(
    async (params: {
      membershipId: number;
      role: MembershipRole;
      csrfToken: string;
    }) => {
      const client = getSupabaseServerActionClient();

      await handleUpdateMemberRequest(client, params);

      return {
        success: true,
      };
    }
  )
);

export const deleteMemberAction = withCsrfCheck(
  withSession(async (params: { membershipId: number; csrfToken: string }) => {
    const client = getSupabaseServerActionClient();

    await handleRemoveMemberRequest(client, params.membershipId);
    await revalidatePath("/settings/organization/members");

    return {
      success: true,
    };
  })
);

export const acceptInviteAction = withCsrfCheck(
  async (params: { code: string; csrfToken: string; userId?: string }) => {
    const code = params.code;

    const logger = getLogger();
    const adminClient = getSupabaseServerActionClient({ admin: true });

    // if the user ID is provided, we use it
    // (for example, when signing up for the 1st time)
    let userId = params.userId;
    let signedIn = false;

    // if the user ID is not provided, we try to get it from the session
    if (!userId) {
      const client = getSupabaseServerActionClient();
      const { data } = await client.auth.getSession();

      // if the session is not available, we throw an error
      if (!data.session) {
        throw new Error(`Session not available`);
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

    const { data, error } = await acceptInviteToOrganization(adminClient, {
      code,
      userId,
    });

    if (error) {
      throw new Error(
        `Error accepting invite to organization: ${error.message}`
      );
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

    const organizationResponse = await getOrganizationById(
      adminClient,
      organizationId
    );

    if (organizationResponse.error) {
      throw organizationResponse.error;
    }

    // we set the organization ID cookie
    const uuid = organizationResponse.data.uuid;
    cookies().set(createOrganizationIdCookie(uuid));

    const needsEmailVerification =
      siteConfig.auth.requireEmailConfirmation && !signedIn;

    // if the user is *not* required to confirm their email
    // we redirect them to the app home
    if (!needsEmailVerification) {
      logger.info(
        {
          membershipId,
        },
        `Redirecting user to app home...`
      );

      return redirect("/dashboard");
    }

    logger.info(
      {
        membershipId,
      },
      `User needs to verify their email address - returning JSON response...`
    );

    return needsEmailVerification;
  }
);

async function handleRemoveMemberRequest(
  client: DatabaseClient,
  membershipId: number
) {
  const logger = getLogger();

  logger.info(
    {
      membershipId,
    },
    `Removing member...`
  );

  await deleteMembershipById(client, membershipId);

  logger.info(
    {
      membershipId,
    },
    `Member successfully removed.`
  );

  await revalidatePath("/settings/organization/members");
}

async function handleUpdateMemberRequest(
  client: DatabaseClient,
  params: {
    membershipId: number;
    role: MembershipRole;
  }
) {
  const logger = getLogger();
  const { role, membershipId } = getUpdateMembershipBodySchema().parse(params);

  logger.info(
    {
      membershipId,
      role,
    },
    `Updating member...`
  );

  await updateMembershipById(client, {
    id: membershipId,
    role,
  });

  logger.info(
    {
      membershipId,
    },
    `Member successfully updated.`
  );

  await revalidatePath("/settings/organization/members");
}

function getUpdateMembershipBodySchema() {
  return z.object({
    role: z.nativeEnum(MembershipRole),
    membershipId: z.number(),
  });
}
