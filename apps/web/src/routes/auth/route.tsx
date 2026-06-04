import { createFileRoute, Outlet } from "@tanstack/react-router";

import { siteConfig } from "@/lib/site-config";

export const Route = createFileRoute("/auth")({
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <div className="flex min-h-screen">
      <div className="bg-zinc-900 text-white hidden flex-col justify-between p-10 lg:flex lg:w-1/2">
        <a href="/" className="flex items-center text-lg font-medium">
          {siteConfig.name}
        </a>
        <p className="text-zinc-400 text-lg">{siteConfig.description}</p>
        <div />
      </div>
      <div className="flex w-full items-center justify-center px-6 lg:w-1/2">
        <div className="w-full max-w-sm space-y-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
