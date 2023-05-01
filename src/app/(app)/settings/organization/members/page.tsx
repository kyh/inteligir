import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { use } from "react";

import type { User } from "@supabase/gotrue-js";
import type { SupabaseClient } from "@supabase/supabase-js";


import { parseOrganizationIdCookie } from "~/lib/server/cookies/organization.cookie";

import {
  getFirstOrganizationByUserId,
  getMembersAuthMetadata,
  getOrganizationInvitedMembers,
  getOrganizationMembers,
} from "~/lib/organizations/database/queries";

import configuration from "~/configuration";
import getSupabaseServerClient from "~/core/supabase/server-client";
import type MembershipRole from "~/lib/organizations/types/membership-role";
import type UserData from "~/core/session/types/user-data";

import requireSession from "~/lib/user/require-session";
import SettingsTile from "~/app/(app)/settings/components/SettingsTile";
import OrganizationMembersList from "~/app/(app)/settings/organization/components/OrganizationMembersList";
import OrganizationInvitedMembersList from "~/app/(app)/settings/organization/components/OrganizationInvitedMembersList";
import InviteMembersLinkButton from "~/app/(app)/settings/organization/components/InviteMembersLinkButton";

export const metadata = {
  title: "Members",
};

const OrganizationMembersPage = () => {
  const data = use(loadMembers());

  return <>
    <div className="flex flex-1 flex-col space-y-6">
      <SettingsTile
        heading={Members}
        subHeading={Manage and Invite members}
        actions={<InviteMembersLinkButton />}
      >
        <OrganizationMembersList members={data.members} />
      </SettingsTile>

      <SettingsTile
        heading={Pending Invites}
        subHeading={Manage invites not yet accepted}
      >
        <OrganizationInvitedMembersList
          invitedMembers={data.invitedMembers || []}
        />
      </SettingsTile>
    </div>
  </>;
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

  let organizationId: number | undefined = Number(
    await parseOrganizationIdCookie(cookies())
  );

  const sessionResult = await requireSession(client);

  if ("redirect" in sessionResult) {
    return redirect(sessionResult.destination);
  }

  if (Number.isNaN(organizationId)) {
    const userId = sessionResult.user.id;

    organizationId = await getFirstOrganizationByUserId(client, userId).then(
      (result) => result?.data?.organization.id
    );
  }

  if (!organizationId) {
    throw redirect(configuration.paths.appHome);
  }

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
