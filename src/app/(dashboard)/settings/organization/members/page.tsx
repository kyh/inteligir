import { use } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/gotrue-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import configuration from "~/configuration";
import type UserData from "~/core/session/types/user-data";
import getSupabaseServerClient from "~/core/supabase/server-client";
import {
  getFirstOrganizationByUserId,
  getMembersAuthMetadata,
  getOrganizationInvitedMembers,
  getOrganizationMembers,
} from "~/lib/organizations/database/queries";
import type MembershipRole from "~/lib/organizations/types/membership-role";
import getCurrentOrganization from "~/lib/server/organizations/get-current-organization";
import requireSession from "~/lib/user/require-session";
import SettingsTile from "~/app/(dashboard)/settings/components/SettingsTile";
import InviteMembersLinkButton from "~/app/(dashboard)/settings/organization/components/InviteMembersLinkButton";
import OrganizationInvitedMembersList from "~/app/(dashboard)/settings/organization/components/OrganizationInvitedMembersList";
import OrganizationMembersList from "~/app/(dashboard)/settings/organization/components/OrganizationMembersList";

export const metadata = {
  title: "Members",
};

const OrganizationMembersPage = () => {
  const data = use(loadMembers());

  return (
    <>
      <div className="flex flex-1 flex-col space-y-6">
        <SettingsTile
          heading={"Members"}
          subHeading={"Manage and Invite members"}
          actions={<InviteMembersLinkButton />}
        >
          <OrganizationMembersList members={data.members} />
        </SettingsTile>

        <SettingsTile
          heading={"Pending Invites"}
          subHeading={"Manage invites not yet accepted"}
        >
          <OrganizationInvitedMembersList
            invitedMembers={data.invitedMembers || []}
          />
        </SettingsTile>
      </div>
    </>
  );
};

export default OrganizationMembersPage;

function getMembersPayload<
  T extends {
    data: UserData;
    role: MembershipRole;
  }
>(members: Array<T | null>, users: User[]) {
  type NonNullMembers = Exclude<T, null>;

  return members
    .filter((value): value is NonNullMembers => !!value)
    .sort((prev, next) => {
      return next.role > prev.role ? 1 : -1;
    })
    .map((member) => {
      const authInfo = users.find((user) => {
        return user.id === member.data.id;
      }) as User;

      return {
        ...member,
        auth: authInfo,
      };
    });
}

async function fetchOrganizationMembers(
  client: SupabaseClient,
  organizationId: number
) {
  const { data, error } = await getOrganizationMembers(client, organizationId);

  if (error) {
    return [];
  }

  const userIds = data.map((member) => member.data.id).filter(Boolean);
  const users = await getMembersAuthMetadata(client, userIds);

  return getMembersPayload(data, users);
}

async function loadMembers() {
  const client = getSupabaseServerClient({
    admin: true,
  });

  const session = await requireSession(client);

  const organizationResponse = await getCurrentOrganization({
    userId: session.user.id,
  });

  if (!organizationResponse) {
    throw redirect("/dashboard");
  }

  const organizationId = organizationResponse.organization.id;

  const [members, invitedMembers] = await Promise.all([
    fetchOrganizationMembers(client, organizationId).catch(() => []),
    getOrganizationInvitedMembers(client, organizationId).then(
      (result) => result.data
    ),
  ]);

  return {
    members,
    invitedMembers,
  };
}
