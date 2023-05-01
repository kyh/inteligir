import { z } from "zod";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";

import getLogger from "~/core/logger";
import { throwInternalServerErrorException } from "~/core/http-exceptions";
import getSupabaseServerClient from "~/core/supabase/server-client";

import requireSession from "~/lib/user/require-session";

export async function POST(req: Request) {
  const logger = getLogger();
  const client = getSupabaseServerClient();

  try {
    const sessionResult = await requireSession(client);

    if ("redirect" in sessionResult) {
      return redirect(sessionResult.destination);
    }

    const { organization } = await getBodySchema().parseAsync(await req.json());
    const userId = sessionResult.user.id;

    logger.info(
      {
        userId,
        organization,
      },
      `Creating organization...`
    );

    const { data: organizationId, error } = await client
      .rpc("create_new_organization", {
        org_name: organization,
        user_id: userId,
        create_user: false,
      })
      .throwOnError()
      .single();

    if (error) {
      return handleError(error);
    }

    logger.info(
      {
        userId,
        organization,
      },
      `Organization successfully created`
    );

    const response = NextResponse.json({ organizationId });

    response.cookies.set("organizationId", organizationId, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });

    return response;
  } catch (error) {
    return handleError(error);
  }
}

function handleError(error: unknown) {
  getLogger().error(
    {
      error,
    },
    "Error creating organization"
  );

  throwInternalServerErrorException();
}

function getBodySchema() {
  return z.object({
    organization: z.string().min(1),
  });
}
