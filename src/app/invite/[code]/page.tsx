import { use } from "react";
import { isNotFoundError } from "next/dist/client/components/not-found";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerComponentSupabaseClient } from "@supabase/auth-helpers-nextjs";
import { Database } from "~/database.types";
import invariant from "tiny-invariant";
import getLogger from "~/core/logger";
import getSupabaseServerClient from "~/core/supabase/server-client";
import { getMembershipByInviteCode } from "~/lib/memberships/queries";
import Heading from "~/components/Heading";
import If from "~/components/If";
import ExistingUserInviteForm from "../components/ExistingUserInviteForm";
import InviteCsrfTokenProvider from "../components/InviteCsrfTokenProvider";
import NewUserInviteForm from "../components/NewUserInviteForm";

interface Context {
  params: {
    code: string;
  };
}

export const metadata = {
  title: `Join Organization`,
};

const InvitePage = ({ params }: Context) => {
  const data = use(loadInviteData(params.code));
  const organization = data.membership.organization;

  return (
    <>
      <Heading type={4}>Join {organization.name}</Heading>

      <div>
        <p className="text-center">
          You were invited to join <b>{organization.name}</b>
        </p>

        <p className="text-center">
          <If condition={!data.session}>
            Please sign in/up to accept the invite
          </If>
        </p>
      </div>

      <InviteCsrfTokenProvider csrfToken={data.csrfToken}>
        <If condition={data.session} fallback={<NewUserInviteForm />}>
          {(session) => <ExistingUserInviteForm session={session} />}
        </If>
      </InviteCsrfTokenProvider>
    </>
  );
};

export default InvitePage;

async function loadInviteData(code: string) {
  const logger = getLogger();

  // we use an admin client to be able to read the pending membership
  const adminClient = getSupabaseServerClient({ admin: true });

  try {
    const { data: membership, error } = await getMembershipByInviteCode<{
      id: number;
      code: string;
      organization: {
        name: string;
        id: number;
      };
    }>(adminClient, {
      code,
      query: `
        id,
        code,
        organization: organization_id (
          name,
          id
        )
      `,
    });

    // if the invite wasn't found, it's 404
    if (error) {
      logger.warn(
        {
          code,
        },
        `User navigated to invite page, but it wasn't found. Redirecting to home page...`
      );

      return notFound();
    }

    const { data: userSession } = await adminClient.auth.getSession();
    const session = userSession?.session;
    const csrfToken = headers().get("x-csrf-token");

    return {
      csrfToken,
      session,
      membership,
      code,
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return notFound();
    }
    logger.error(
      error,
      `Error encountered while fetching invite. Redirecting to home page...`
    );

    return redirect("/");
  }
}

/**
 * @name getAdminClient
 */
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  invariant(url, `Supabase URL not provided`);
  invariant(serviceRoleKey, `Supabase Service role key not provided`);

  // we build a server client to be able to read the pending membership
  // bypassing the session using empty headers and cookies
  return createServerComponentSupabaseClient<Database>({
    supabaseUrl: url,
    supabaseKey: serviceRoleKey,
    headers: () => {},
    cookies: () => {},
  });
}
