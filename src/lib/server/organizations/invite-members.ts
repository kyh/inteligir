import { siteConfig } from "~/config/site";
import type { DatabaseClient } from "~/core/db";
import sendEmail from "~/core/email/send-email";
import getLogger from "~/core/logger";
import {
  createOrganizationMembership,
  updateMembershipById,
} from "~/lib/memberships/mutations";
import {
  getMembershipByEmail,
  getUserMembershipByOrganization,
} from "~/lib/memberships/queries";
import { canInviteUser } from "~/lib/organizations/permissions";
import { getOrganizationByUid } from "~/lib/organizations/queries";
import type Membership from "~/lib/organizations/types/membership";
import type MembershipRole from "~/lib/organizations/types/membership-role";
import { getUserById } from "~/lib/user/queries";

type Invite = {
  email: string;
  role: MembershipRole;
};

type Params = {
  // we use the normal client to query/insert data and leverage RLS for security
  client: DatabaseClient;
  // we use the admin client to retrieve the user's email address
  adminClient: DatabaseClient;

  organizationUid: string;
  inviterId: string;
  invites: Invite[];
};

const inviteMembers = async (params: Params) => {
  const { organizationUid, invites, inviterId, adminClient, client } = params;
  const logger = getLogger();

  const [{ data: inviter }, { data: organization }] = await Promise.all([
    getUserById(client, params.inviterId),
    getOrganizationByUid(client, params.organizationUid),
  ]);

  // Check if the inviter exists
  if (!inviter) {
    return Promise.reject(`Inviter record was not found`);
  }

  // Check if the organization exists
  if (!organization) {
    return Promise.reject(`Organization record was not found`);
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
  const requests: Array<Promise<unknown>> = [];

  // for each invite in the list
  // 1. send and create the invite if it does not yet exist
  // 2. otherwise, update the invite if it already exists
  for (const invite of invites) {
    // validate that the user has permissions
    // to invite the user based on their roles
    if (!canInviteUser(inviterRole, invite.role)) {
      continue;
    }

    let inviterDisplayName = inviter?.displayName;

    // when the inviter has no name in its record,
    // we fall back to their email
    if (!inviterDisplayName) {
      const { data: inviterEmail, error } =
        await adminClient.auth.admin.getUserById(inviter.id);

      if (!error) {
        inviterDisplayName = inviterEmail.user.email;
      }
    }

    const organizationLogo = organization?.logoURL ?? undefined;

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
        const membershipId = existingInvite?.id as number;
        const code = existingInvite?.code;

        if (!code) {
          return Promise.reject(`Code not found on membership`);
        }

        try {
          const params = {
            id: membershipId,
            role: invite.role,
          };

          await updateMembershipById(client, params);

          // send email
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
          await sendEmailRequest(code!);

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

export default inviteMembers;

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

  const { default: renderInviteEmail } = await import("~/lib/emails/invite");

  const sender = siteConfig.email.senderAddress;
  const productName = siteConfig.site.siteName;

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

const getInvitePageFullUrl = (code: string) => {
  let siteUrl = siteConfig.site.siteUrl;

  if (!siteConfig.production) {
    siteUrl = getLocalEnvironmentHost();
  }

  assertSiteUrl(siteUrl);

  return [siteUrl, "invite", code].join("/");
};

const assertSiteUrl = (siteUrl: Maybe<string>) => {
  if (!siteUrl && siteConfig.production) {
    throw new Error(
      `Please configure the "siteUrl" property in the file ~/config/siteConfig.ts`,
    );
  }
};

const getLocalEnvironmentHost = () => {
  const host = `http://localhost`;
  const port = 3000;

  return [host, port].join(":");
};
