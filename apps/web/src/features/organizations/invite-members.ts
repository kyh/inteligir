import type { SupabaseClient } from "@/lib/supabase/client";
import { canInviteUser } from "@/features/organizations/permissions";
import { sendEmail } from "@/lib/emails/send-email";
import {
  getMembershipByEmail,
  getUserMembershipByOrganization,
} from "@/features/memberships/queries";
import {
  createOrganizationMembership,
  updateMembershipById,
} from "@/features/memberships/mutations";
import type { MembershipRole } from "@/features/organizations/membership-role";
import { getLogger } from "@/lib/utils/logger";
import { getUserById } from "@/features/users/queries";
import { getOrganizationByUid } from "@/features/organizations/queries";
import type { Membership } from "@/features/organizations/membership";

type Invite = {
  email: string;
  role: MembershipRole;
};

type Params = {
  // we use the normal client to query/insert data and leverage RLS for security
  client: SupabaseClient;

  // we use the admin client to retrieve the user's email address
  adminClient: SupabaseClient;
  organizationUid: string;
  inviterId: string;
  invites: Invite[];
};

export const inviteMembers = async (params: Params) => {
  const { organizationUid, invites, inviterId, adminClient, client } = params;
  const logger = getLogger();

  const [{ data: inviter }, { data: organization }] = await Promise.all([
    getUserById(client, params.inviterId),
    getOrganizationByUid(client, organizationUid),
  ]);

  // Check if the inviter exists
  if (!inviter) {
    return Promise.reject(new Error(`Inviter record was not found`));
  }

  // Check if the organization exists
  if (!organization) {
    return Promise.reject(new Error(`Organization record was not found`));
  }

  const organizationName = organization.name;
  const organizationId = organization.id;

  // retrieve the inviter's membership in the organization to validate permissions
  const { role: inviterRole } = await getUserMembershipByOrganization(client, {
    organizationUid,
    userId: params.inviterId,
  });

  // validate that the inviter is currently in the organization
  if (inviterRole === undefined) {
    throw new Error(
      `Invitee with ID ${inviterId} does not belong to the organization`,
    );
  }

  // we add each invite request to a list of promises
  const requests: Promise<unknown>[] = [];

  // for each invite in the list
  // 1. send and create the invite if it does not yet exist
  // 2. otherwise, update the invite if it already exists
  for (const invite of invites) {
    // validate that the user has permissions
    // to invite the user based on their roles
    if (!canInviteUser(inviterRole, invite.role)) {
      continue;
    }

    let inviterDisplayName = inviter.displayName || "";

    // when the inviter has no name in its record,
    // we fall back to their email
    if (!inviterDisplayName) {
      const { data: inviterEmail, error } =
        await adminClient.auth.admin.getUserById(inviter.id);

      if (!error && inviterEmail.user.email) {
        inviterDisplayName = inviterEmail.user.email;
      }
    }

    const organizationLogo = organization.logoURL ?? undefined;

    const sendEmailRequest = (code: string) =>
      sendInviteEmail({
        code,
        invitedUserEmail: invite.email,
        organizationName,
        organizationLogo,
        inviter: inviterDisplayName,
      });

    const { data: existingInvite } = await getMembershipByEmail(client, {
      organizationId,
      email: invite.email,
    });

    const inviteExists = Boolean(existingInvite);

    // this callback will be called when the promise fails
    const catchCallback = (error: unknown, inviteId?: number) => {
      logger.error(
        {
          inviter: inviter.id,
          inviteId,
          organizationId,
        },
        `Error while sending invite to member`,
      );

      logger.debug(error);

      return Promise.reject(error);
    };

    // if an invitation to the email {invite.email} already exists,
    // then we update the existing document
    if (inviteExists) {
      const request = async () => {
        const membershipId = existingInvite?.id!;
        const code = existingInvite?.code;

        if (!code) {
          return Promise.reject(new Error(`Code not found on membership`));
        }

        // update membership with new role
        try {
          const params = {
            id: membershipId,
            role: invite.role,
          };

          await updateMembershipById(client, params);
        } catch (error) {
          return catchCallback(error, membershipId);
        }

        // send email
        try {
          await sendEmailRequest(code);
        } catch (error) {
          return catchCallback(error, membershipId);
        }
      };

      // add a promise for each invite
      requests.push(request());
    } else {
      // otherwise, we create a new document with the invite
      const request = async () => {
        const membership: Partial<Membership> = {
          invitedEmail: invite.email,
          role: invite.role,
          organizationId,
        };

        try {
          // add pending membership to the Database
          const { data, error } = await createOrganizationMembership(
            adminClient,
            membership,
          );

          if (error) {
            return catchCallback(error);
          }

          const membershipId = data.id;
          const code = data.code;

          logger.info(
            {
              organizationId,
              membershipId,
            },
            `Membership successfully created`,
          );

          // send email to user
          await sendEmailRequest(code);

          logger.info(
            {
              organizationId,
              membershipId,
            },
            `Membership invite successfully sent`,
          );
        } catch (e) {
          return catchCallback(e);
        }
      };

      // add a promise for each invite
      requests.push(request());
    }
  }

  return Promise.all(requests);
};

const sendInviteEmail = async (props: {
  invitedUserEmail: string;
  code: string;
  organizationName: string;
  organizationLogo: Maybe<string>;
  inviter: Maybe<string>;
}) => {
  const {
    invitedUserEmail,
    code,
    organizationName,
    organizationLogo,
    inviter,
  } = props;

  const { default: renderInviteEmail } = await import("@/lib/emails/invite");

  const sender = process.env.EMAIL_SENDER;
  const productName = configuration.site.siteName;

  if (!sender) {
    return Promise.reject(new Error(`Missing email configuration`));
  }

  const subject = "You have been invited to join an organization!";
  const link = getInvitePageFullUrl(code);

  const html = renderInviteEmail({
    productName,
    link,
    organizationName,
    organizationLogo,
    invitedUserEmail,
    inviter,
  });

  return sendEmail({
    to: invitedUserEmail,
    from: sender,
    subject,
    html,
  });
};

/**
 * Return the full URL to the invite page link. For example,
 * inteligir.com/invite/{INVITE_CODE}
 */
const getInvitePageFullUrl = (code: string) => {
  let siteUrl = configuration.site.siteUrl;

  if (!configuration.production) {
    siteUrl = getLocalEnvironmentHost();
  }

  assertSiteUrl(siteUrl);

  return [siteUrl, "invite", code].join("/");
};

const assertSiteUrl = (siteUrl: Maybe<string>): asserts siteUrl is string => {
  if (!siteUrl && configuration.production) {
    throw new Error(
      `Please configure the "siteUrl" property in the configuration file @/lib/configuration.ts`,
    );
  }
};

const getLocalEnvironmentHost = () => {
  const host = `http://localhost`;
  const port = 3000;

  return [host, port].join(":");
};
