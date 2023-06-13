import { NextRequest, NextResponse } from "next/server";
import { throwInternalServerErrorException } from "~/core/http-exceptions";
import getSupabaseServerClient from "~/core/supabase/server-client";
import { getOrganizationById } from "~/lib/organizations/database/queries";
import { createOrganizationIdCookie } from "~/lib/server/cookies/organization.cookie";

type Params = {
  params: {
    organization: string;
  };
};

export async function PUT(request: NextRequest, { params }: Params) {
  const organizationId = params.organization;

  const client = getSupabaseServerClient();

  try {
    const organization = await getOrganizationById(
      client,
      Number(organizationId)
    );

    if (organization.data) {
      const cookie = createOrganizationIdCookie(Number(organizationId));
      const response = new NextResponse(JSON.stringify({}), {
        status: 200,
      });

      response.cookies.set(cookie);

      return response;
    }
  } catch (error) {
    console.error(error);
    return throwInternalServerErrorException();
  }
}
