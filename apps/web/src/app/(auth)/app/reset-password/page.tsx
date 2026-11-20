import type { Metadata } from "next";
import { Suspense } from "react";

import { authPageSearchSchema } from "#lib/next-path";
import { resetViewOf } from "#lib/reset-link";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

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
