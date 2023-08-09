import MembershipRole from "~/lib/organizations/types/membership-role";

/**
 * Permissions
 *
 * Permissions should be kept here or in a centralized place. Assuming you will add new custom
 * functions to check the user's permission to perform an action, it's recommended that you do it here
 *
 * This helps track down behavior rather than changing logic in every single place, which is
 * going to make it difficult to track down the logic. Keep this lightweight, so you don't need to make
 * different files for server vs client
 *
 * Permissions are defined such that a user can perform a disruptive option on other users
 * only if they have a greater role. For example, an Admin cannot remove another Admin from an organization
 *
 * You can update {@link MembershipRole} however you wish according to your app's domain
 */

export function canUpdateUser(
  currentUserRole: MembershipRole,
  targetUser: MembershipRole,
) {
  return currentUserRole > targetUser;
}

export function canChangeBilling(currentUserRole: MembershipRole) {
  return currentUserRole === MembershipRole.Owner;
}

export function canInviteUsers(currentUserRole: MembershipRole) {
  return currentUserRole >= MembershipRole.Admin;
}

export function canInviteUser(
  inviterRole: MembershipRole,
  inviteeRole: MembershipRole,
) {
  const canInvite = canInviteUsers(inviterRole);
  const hasGreaterRole = inviterRole >= inviteeRole;
  const isNotOwner = inviteeRole !== MembershipRole.Owner;

  return canInvite && hasGreaterRole && isNotOwner;
}

export function canDeleteInvites(inviterRole: MembershipRole) {
  return canInviteUsers(inviterRole);
}
