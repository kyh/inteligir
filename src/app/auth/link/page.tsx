import PageLoadingIndicator from "~/components/PageLoadingIndicator";
import AuthLinkRedirect from "~/app/auth/components/AuthLinkRedirect";

function AuthLinkPage() {
  return (
    <PageLoadingIndicator fullPage={true}>
      <AuthLinkRedirect />
      Signing in...
    </PageLoadingIndicator>
  );
}

export default AuthLinkPage;
