import { cookies } from "next/headers";

const ORGANIZATION_ID_COOKIE_NAME = "organizationId";

export const createOrganizationIdCookie = (organizationId: string) => {
  const secure = process.env.ENVIRONMENT === "production";

  return {
    name: ORGANIZATION_ID_COOKIE_NAME,
    value: organizationId,
    httpOnly: false,
    secure,
    path: "/",
    sameSite: "lax" as const,
  };
};

export const parseOrganizationIdCookie = () => {
  return cookies().get(ORGANIZATION_ID_COOKIE_NAME)?.value;
};
