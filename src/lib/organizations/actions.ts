"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withCsrfCheck, withSession } from "~/core/generic/actions-utils";
import getLogger from "~/core/logger";
import getSupabaseServerActionClient from "~/core/supabase/action-client";
import { transferOwnership } from "~/lib/memberships/mutations";
import { getOrganizationByUid } from "~/lib/organizations/queries";
import MembershipRole from "~/lib/organizations/types/membership-role";
import {
  createOrganizationIdCookie,
  parseOrganizationIdCookie,
} from "~/lib/server/cookies/organization.cookie";
import inviteMembers from "~/lib/server/organizations/invite-members";
import { getUserDataById } from "~/lib/server/queries";
import requireSession from "~/lib/user/require-session";

export const createNewOrganizationAction = withCsrfCheck(
  withSession(async (params: { organization: string; csrfToken: string }) => {
    const logger = getLogger();

    const { organization } = await z
      .object({
        organization: z.string().min(1),
      })
      .parseAsync(params);

    const client = getSupabaseServerActionClient();
    const session = await requireSession(client);

    const userId = session.user.id;

    logger.info(
      {
        userId,
        organization,
      },
      `Creating organization...`
    );

    const { data: organizationUid, error } = await client
      .rpc("create_new_organization", {
        org_name: organization,
        user_id: userId,
        create_user: false,
      })
      .throwOnError()
      .single();

    if (error) {
      return handleError(error, `Error creating organization`);
    }

    logger.info(
      {
        userId,
        organization,
      },
      `Organization successfully created`
    );

    cookies().set(createOrganizationIdCookie(organizationUid));

    const redirectPath = ["dashboard", organizationUid].join("/");

    redirect(redirectPath);
  })
);

export const transferOrganizationOwnershipAction = withCsrfCheck(
  withSession(
    async (
      params: z.infer<
        ReturnType<typeof getTransferOrganizationOwnershipBodySchema>
      >
    ) => {
      const result =
        await getTransferOrganizationOwnershipBodySchema().safeParseAsync(
          params
        );

      // validate the form data
      if (!result.success) {
        throw new Error(`Invalid form data`);
      }

      const logger = getLogger();
      const client = getSupabaseServerActionClient();

      const organizationUid = await parseOrganizationIdCookie(cookies());

      if (!organizationUid) {
        throw new Error(`Invalid organization UUID`);
      }

      const targetUserMembershipId = result.data.membershipId;
      const session = await requireSession(client);

      const currentUserId = session.user.id;
      const currentUser = await getUserDataById(client, currentUserId);

      logger.info(
        {
          organizationUid,
          currentUserId,
          targetUserMembershipId,
        },
        `Transferring organization ownership...`
      );

      // return early if we can't get the current user
      if (!currentUser) {
        throw new Error(`User is not logged in or does not exist`);
      }

      const { error, data: organization } = await getOrganizationByUid(
        client,
        organizationUid
      );

      if (error || !organization) {
        logger.error(
          {
            organizationUid,
            currentUserId,
            targetUserMembershipId,
          },
          `Error retrieving organization`
        );

        throw new Error(`Error retrieving organization`);
      }

      // transfer ownership to the target user
      const transferOwnershipResponse = await transferOwnership(client, {
        organizationId: organization.id,
        targetUserMembershipId,
      });

      if (transferOwnershipResponse.error) {
        logger.error(
          {
            error,
            organizationUid,
            currentUserId,
            targetUserMembershipId,
          },
          `Error transferring organization ownership`
        );

        throw new Error(`Error transferring ownership`);
      }

      // all done! we log the result and return a 200
      logger.info(
        {
          organizationUid,
          currentUserId,
          targetUserMembershipId,
        },
        `Ownership successfully transferred to target user`
      );

      return { success: true };
    }
  )
);

export const inviteMembersToOrganizationAction = withCsrfCheck(
  withSession(
    async (payload: z.infer<ReturnType<typeof getInviteMembersBodySchema>>) => {
      const { invites } = await getInviteMembersBodySchema().parseAsync(
        payload
      );

      const logger = getLogger();

      const organizationUid = await parseOrganizationIdCookie(cookies());
      const client = getSupabaseServerActionClient();
      const session = await requireSession(client);
      const inviterId = session.user.id;

      // throw an error when we cannot retrieve the inviter's id or the organization id
      if (!inviterId) {
        throw new Error(`User is not logged in or does not exist`);
      }

      if (!organizationUid) {
        throw new Error(`Organization not found`);
      }

      const adminClient = getSupabaseServerActionClient({ admin: true });

      const params = {
        client,
        adminClient,
        invites,
        organizationUid,
        inviterId,
      };

      try {
        // send requests to invite members
        await inviteMembers(params);

        logger.info(
          {
            organizationUid,
          },
          `Successfully invited members to organization`
        );
      } catch (e) {
        const message = `Error when inviting user to organization`;

        logger.error(`${message}: ${JSON.stringify(e)}`);

        throw new Error(message);
      }

      const appHome = "/dashboard";
      const path = `/settings/organization/members`;
      const redirectPath = [appHome, organizationUid, path].join("/");

      redirect(redirectPath);
    }
  )
);

function getInviteMembersBodySchema() {
  return z.object({
    csrfToken: z.string().min(1),
    invites: z.array(
      z.object({
        role: z.nativeEnum(MembershipRole),
        email: z.string().email(),
      })
    ),
  });
}

function getTransferOrganizationOwnershipBodySchema() {
  return z.object({
    membershipId: z.coerce.number(),
    csrfToken: z.string().min(1),
  });
}

function handleError<Error = unknown>(
  error: Error,
  message: string,
  organizationId?: string
) {
  const exception = error instanceof Error ? error.message : undefined;

  getLogger().error(
    {
      exception,
      organizationId,
    },
    message
  );

  throw new Error(message);
}
