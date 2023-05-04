import { redirect } from "next/navigation";
import { z } from "zod";
import configuration from "~/configuration";
import {
  throwBadRequestException,
  throwInternalServerErrorException,
} from "~/core/http-exceptions";
import getLogger from "~/core/logger";
import getSupabaseServerClient from "~/core/supabase/server-client";
import completeOnboarding from "~/lib/server/onboarding/complete-onboarding";
import requireSession from "~/lib/user/require-session";

export async function POST(req: Request) {
  const logger = getLogger();

  const client = getSupabaseServerClient();
  const session = await requireSession(client);
  const userId = session.user.id;

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
