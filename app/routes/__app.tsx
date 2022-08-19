import { json, LoaderArgs } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { getFlash } from "~/lib/core/server/session.server";
import { ToastProvider } from "~/components/Toaster";

export const loader = async ({ request }: LoaderArgs) => {
  const { message, headers } = await getFlash(request);

  return json({ message }, { headers });
};

const Page = () => {
  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
};

export default Page;
