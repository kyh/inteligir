import type { Metadata } from "next";
import { Suspense } from "react";

import { authPageSearchSchema } from "#lib/next-path";
import { resetViewOf } from "#lib/reset-link";

import { ResetPasswordForm } from "./reset-password-form";

// The address carries a live single-use token: no request the page makes repeats it, and the page
// is rendered per request, which Next answers with no-store.
export const metadata: Metadata = { referrer: "no-referrer", title: "Choose a new password" };

const ResetPasswordEntry = async ({
  searchParams,
}: Pick<PageProps<"/app/reset-password">, "searchParams">) => {
  const search = await searchParams;
  const { next } = authPageSearchSchema.parse(search);
  return <ResetPasswordForm link={resetViewOf(search)} next={next} />;
};

const ResetPasswordPage = ({ searchParams }: PageProps<"/app/reset-password">) => (
  <Suspense fallback={null}>
    <ResetPasswordEntry searchParams={searchParams} />
  </Suspense>
);

export default ResetPasswordPage;
