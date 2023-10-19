"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSupabaseServerActionClient } from "@/lib/supabase/action-client";
import { withSession } from "@/lib/utils/actions-utils";
import { createOrganizationIdCookie } from "@/features/organizations/organization-cookie";
import { requireSession } from "@/features/auth/require-session";
import { transferOwnership } from "@/features/memberships/mutations";
import { inviteMembers } from "@/features/organizations/invite-members";
import { getUserById } from "@/features/users/queries";
import { getLogger } from "@/lib/utils/logger";
import { MembershipRole } from "@/features/organizations/membership-role";
import { getOrganizationByUid } from "@/features/organizations/queries";

export const createNewOrganizationAction = withSession(
  async (params: { organization: string; csrfToken: string }) => {
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
      `Creating organization...`,
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
      handleError(error, `Error creating organization`);
      return;
    }

    logger.info(
      {
        userId,
        organization,
      },
      `Organization successfully created`,
    );

    cookies().set(
      createOrganizationIdCookie({
        userId,
        organizationUid,
      }),
    );

    const redirectPath = ["/dashboard", organizationUid].join("/");

    redirect(redirectPath);
  },
);

export const transferOrganizationOwnershipAction = withSession(
  async (
    params: z.infer<
      ReturnType<typeof getTransferOrganizationOwnershipBodySchema>
    >,
  ) => {
    const result =
      await getTransferOrganizationOwnershipBodySchema().safeParseAsync(params);

    // validate the form data
    if (!result.success) {
      throw new Error(`Invalid form data`);
    }

    const logger = getLogger();
    const client = getSupabaseServerActionClient();

    const targetUserMembershipId = result.data.membershipId;
    const organizationUid = result.data.organizationUid;
    const session = await requireSession(client);

    const currentUserId = session.user.id;
    const { data: currentUser } = await getUserById(client, currentUserId);

    logger.info(
      {
        organizationUid,
        currentUserId,
        targetUserMembershipId,
      },
      `Transferring organization ownership...`,
    );

    // return early if we can't get the current user
    if (!currentUser) {
      throw new Error(`User is not logged in or does not exist`);
    }

    const { error, data: organization } = await getOrganizationByUid(
      client,
      organizationUid,
    );

    if (error || !organization) {
      logger.error(
        {
          organizationUid,
          currentUserId,
          targetUserMembershipId,
        },
        `Error retrieving organization`,
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
        `Error transferring organization ownership`,
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
      `Ownership successfully transferred to target user`,
    );

    const appHome = "/dashboard";
    const path = `/settings/organization/members`;
    const pathToRevalidate = [appHome, organizationUid, path].join("/");

    // revalidate the organization members page
    revalidatePath(pathToRevalidate, "page");

    return {
      success: true,
    };
  },
);

export const inviteMembersToOrganizationAction = withSession(
  async (payload: z.infer<ReturnType<typeof getInviteMembersBodySchema>>) => {
    const { invites, organizationUid } =
      await getInviteMembersBodySchema().parseAsync(payload);

    if (!organizationUid) {
      throw new Error(`Organization not found`);
    }

    const logger = getLogger();
    const client = getSupabaseServerActionClient();
    const session = await requireSession(client);
    const inviterId = session.user.id;

    // throw an error when we cannot retrieve the inviter's id or the organization id
    if (!inviterId) {
      throw new Error(`User is not logged in or does not exist`);
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
        `Successfully invited members to organization`,
      );
    } catch (e) {
      const message = `Error when inviting user to organization`;

      logger.error(`${message}: ${JSON.stringify(e)}`);

      throw new Error(message);
    }

    const appHome = "/dashboard";
    const path = `/settings/organization/members`;
    const redirectPath = [appHome, organizationUid, path].join("/");

    revalidatePath(redirectPath, "page");

    redirect(redirectPath);
  },
);

const getInviteMembersBodySchema = () =>
  z.object({
    csrfToken: z.string().min(1),
    organizationUid: z.string().uuid(),
    invites: z.array(
      z.object({
        role: z.nativeEnum(MembershipRole),
        email: z.string().email(),
      }),
    ),
  });

const getTransferOrganizationOwnershipBodySchema = () =>
  z.object({
    membershipId: z.coerce.number(),
    csrfToken: z.string().min(1),
    organizationUid: z.string().uuid(),
  });

const handleError = <Error = unknown>(
  error: Error,
  message: string,
  organizationId?: string,
) => {
  const exception = error instanceof Error ? error.message : undefined;

  getLogger().error(
    {
      exception,
      organizationId,
    },
    message,
  );

  throw new Error(message);
};
