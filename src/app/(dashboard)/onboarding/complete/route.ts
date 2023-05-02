import { z } from "zod";
import { redirect } from "next/navigation";

import getLogger from "~/core/logger";
import requireSession from "~/lib/user/require-session";
import completeOnboarding from "~/lib/server/onboarding/complete-onboarding";

import {
  throwBadRequestException,
  throwInternalServerErrorException,
} from "~/core/http-exceptions";

import getSupabaseServerClient from "~/core/supabase/server-client";
import configuration from "~/configuration";

export async function POST(req: Request) {
  const logger = getLogger();

  const client = await getSupabaseServerClient();
  const sessionResult = await requireSession(client);

  if ("redirect" in sessionResult) {
    return redirect(sessionResult.destination);
  }

  const userId = sessionResult.user.id;
  const body = await req.json();
  const parsedBody = await getBodySchema().safeParseAsync(body);

  if (!parsedBody.success) {
    return throwBadRequestException(`Invalid request body`);
  }

  const organizationName = parsedBody.data.organization;

  const payload = {
    userId,
    organizationName,
    client,
  };

  logger.info(
    {
      userId,
    },
    `Completing onboarding for user...`
  );

  // complete onboarding and get the organization id created
  const { data: organizationId, error } = await completeOnboarding(payload);

  if (error) {
    logger.error(
      {
        error,
        userId,
      },
      `Error completing onboarding for user`
    );

    throw throwInternalServerErrorException();
  }

  logger.info(
    {
      userId,
      organizationId,
    },
    `Onboarding successfully completed for user`
  );

  return redirect(configuration.paths.appHome);
}

function getBodySchema() {
  return z.object({
    organization: z.string().trim().min(1),
  });
}
