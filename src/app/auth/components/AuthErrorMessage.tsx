import { AuthError } from "@supabase/gotrue-js";
import { Alert } from "~/components/Alert";

export default function AuthErrorMessage({
  error,
}: {
  error: Maybe<Error | AuthError | unknown>;
}) {
  if (!error) return null;

  const errorCode = error instanceof AuthError ? error.message : error;

  return (
    <Alert className="w-full" type="error">
      <Alert.Heading>Sorry, we could not authenticate you</Alert.Heading>
      <p className="text-sm font-medium" data-cy="auth-error-message">
        Please try again.
      </p>
    </Alert>
  );
}
