import PageLoadingIndicator from "~/core/ui/PageLoadingIndicator";
import AuthLinkRedirect from "~/app/auth/components/AuthLinkRedirect";
import Trans from "~/core/ui/Trans";

function AuthLinkPage() {
  return (
    <PageLoadingIndicator fullPage={true}>
      <AuthLinkRedirect />

      <Trans i18nKey="auth:signingIn" />
    </PageLoadingIndicator>
  );
}

export default AuthLinkPage;
