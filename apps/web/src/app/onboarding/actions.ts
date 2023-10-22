"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { RedirectType, redirect } from "next/navigation";
import { requireSession } from "@/features/auth/require-session";
import { completeOnboarding } from "@/features/onboarding/complete-onboarding";
import { getSupabaseServerActionClient } from "@/lib/supabase/action-client";
import { createOrganizationIdCookie } from "@/features/organizations/organization-cookie";
import { withSession } from "@/lib/utils/actions-utils";
import { getLogger } from "@/lib/utils/logger";

export const handleOnboardingCompleteAction = withSession(
  async (data: z.infer<ReturnType<typeof getBodySchema>>) => {
    const logger = getLogger();

    const client = getSupabaseServerActionClient();
    const session = await requireSession(client);
    const userId = session.user.id;
    const body = await getBodySchema().safeParseAsync(data);

    if (!body.success) {
      throw new Error(`Invalid request body`);
    }

    const organizationName = body.data.organization;

    const payload = {
      userId,
      organizationName,
      client,
    };

    logger.info(
      {
        userId,
      },
      `Completing onboarding for user...`,
    );

    // complete onboarding and get the organization id created
    const { data: organizationUid, error } = await completeOnboarding(payload);

    if (error) {
      logger.error(
        {
          error,
          userId,
        },
        `Error completing onboarding for user`,
      );

      throw new Error();
    }

    logger.info(
      {
        userId,
        organizationUid,
      },
      `Onboarding successfully completed for user`,
    );

    cookies().set(createOrganizationIdCookie({ userId, organizationUid }));

    const redirectPath = ["/dashboard", organizationUid].join("/");

    return redirect(redirectPath, RedirectType.replace);
  },
);

const getBodySchema = () =>
  z.object({
    organization: z.string().trim().min(1),
    csrfToken: z.string(),
  });
