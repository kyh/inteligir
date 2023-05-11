import AuthProviderLogo from "~/components/AuthProviderLogo";
import Button from "~/components/Button";

const AuthProviderButton: React.FCC<{
  providerId: string;
  onClick: () => unknown;
}> = ({ children, providerId, onClick }) => {
  return (
    <Button
      data-cy="auth-provider-button"
      onClick={onClick}
      data-provider={providerId}
    >
      <span className="absolute left-3 flex items-center justify-start">
        <AuthProviderLogo providerId={providerId} />
      </span>

      <span className="flex w-full flex-1 items-center">
        <span className="flex w-full items-center justify-center">
          <span className="text-current">{children}</span>
        </span>
      </span>
    </Button>
  );
};

export default AuthProviderButton;
