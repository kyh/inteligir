import MembershipRole from "~/lib/organizations/types/membership-role";

/**
 * User Roles
 *
 * Here is where you can edit the user roles in your application according
 * to your application's domain.
 *
 * For example, you could add a role named
 * "Account Manager":
 * 1. extend the enum {@link MembershipRole}
 * 2. add the i18n strings
 * 3. apply any needed change to ~/lib/permissions.ts
 * 4. add a new model below, so you can display the correct data in the
 * selector component {@link MembershipRoleSelector}
 */

const OWNER = {
  label: "owner",
  description: "",
  value: MembershipRole.Owner,
};

const ADMIN = {
  label: "admin",
  description: "",
  value: MembershipRole.Admin,
};

const MEMBER = {
  label: "member",
  description: "",
  value: MembershipRole.Member,
};

const roles = [OWNER, ADMIN, MEMBER];

export default roles;
