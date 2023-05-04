import EmailPasswordSignInContainer from "~/app/auth/components/EmailPasswordSignInContainer";
import OAuthProviders from "~/app/auth/components/OAuthProviders";

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
