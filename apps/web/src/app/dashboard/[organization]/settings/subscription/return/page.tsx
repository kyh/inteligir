import { notFound, redirect } from "next/navigation";
import { StripeSessionStatus } from "./components/stripe-session-status";
import RecoverStripeCheckout from "./components/recover-stripe-checkout";
import requireSession from "~/lib/user/require-session";
import getSupabaseServerClient from "~/core/supabase/server-client";
import getStripeInstance from "~/core/stripe/get-stripe";
import { withI18n } from "~/i18n/with-i18n";

type SessionPageProps = {
  searchParams: {
    session_id: string;
  };
};

const ReturnStripeSessionPage = async ({ searchParams }: SessionPageProps) => {
  const { status, customerEmail, clientSecret } = await loadStripeSession(
    searchParams.session_id,
  );

  if (clientSecret) {
    return <RecoverStripeCheckout clientSecret={clientSecret} />;
  }

  return (
    <>
      <div className="fixed left-0 top-48 z-50 mx-auto w-full">
        <StripeSessionStatus
          customerEmail={customerEmail ?? ""}
          status={status}
        />
      </div>
      <div
        className={
          "bg-background/30 fixed left-0 top-0 w-full backdrop-blur-sm" +
          " !m-0 h-full"
        }
      />
    </>
  );
};

export default withI18n(ReturnStripeSessionPage);

export const loadStripeSession = async (sessionId: string) => {
  await requireSession(getSupabaseServerClient());

  // now we fetch the session from Stripe
  // and check if it's still open
  const stripe = await getStripeInstance();

  const session = await stripe.checkout.sessions
    .retrieve(sessionId)
    .catch(() => undefined);

  if (!session) {
    notFound();
  }

  const isSessionOpen = session.status === "open";
  const clientSecret = isSessionOpen ? session.client_secret : null;
  const isEmbeddedMode = session.ui_mode === "embedded";

  // if the session is still open, we redirect the user to the checkout page
  // in Stripe self hosted mode
  if (isSessionOpen && !isEmbeddedMode && session.url) {
    redirect(session.url);
  }

  // otherwise - we show the user the return page
  // and display the details of the session
  return {
    status: session.status,
    customerEmail: session.customer_details?.email,
    clientSecret,
  };
};
