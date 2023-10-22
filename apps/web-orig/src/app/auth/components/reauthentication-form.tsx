import OAuthProviders from "@/app/auth/components/oauth-providers";
import EmailPasswordSignInContainer from "@/app/auth/components/email-password-sign-in-container";

const ReauthenticationForm: React.FC<{
  onSuccess: EmptyCallback;
}> = ({ onSuccess }) => {
  return (
    <div className="flex flex-col space-y-4">
      <OAuthProviders />
      <EmailPasswordSignInContainer onSignIn={onSuccess} />
    </div>
  );
};

export default ReauthenticationForm;
