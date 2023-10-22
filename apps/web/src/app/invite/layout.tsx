import AuthPageShell from "@/app/auth/components/auth-page-shell";
import initializeServerI18n from "@/i18n/i18n.server";
import getLanguageCookie from "@/i18n/get-language-cookie";

const InvitePageLayout = async ({ children }: React.PropsWithChildren) => {
  const { language } = await initializeServerI18n(getLanguageCookie());

  return <AuthPageShell language={language}>{children}</AuthPageShell>;
};

export default InvitePageLayout;
