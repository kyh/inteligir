import { createFileRoute, redirect } from "@tanstack/react-router";

// `/app` bare is the layout with no child, which renders an empty document at
// 200 — a URL that answers and shows nothing. It is also the address the
// retired hosted workspace lived at, so it is one people and links still have.
// Sign-in is where every child of this layout leads anyway.
export const Route = createFileRoute("/app/")({
  beforeLoad: () => {
    throw redirect({ to: "/app/sign-in" });
  },
});
