import AuthPageShell from "~/app/auth/components/AuthPageShell";

function InvitePageLayout({ children }: React.PropsWithChildren) {
  return <AuthPageShell>{children}</AuthPageShell>;
}

export default InvitePageLayout;
