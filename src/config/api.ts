export const apiConfig = {
  paths: {
    checkout: `/api/stripe/checkout`,
    billingPortal: `/api/stripe/portal`,
    organizations: {
      create: `/api/organizations`,
      current: `/api/organizations/[organization]/current`,
      transferOwnership: `/api/organizations/owner`,
      members: `/api/organizations/members`,
      member: `/api/organizations/members/[member]`,
    },
  },
};
