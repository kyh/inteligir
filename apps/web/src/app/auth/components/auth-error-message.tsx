import { AuthError } from "@supabase/gotrue-js";
import Alert from "@inteligir/ui/alert";

/**
 * This error comes from Supabase as the code returned on errors
 * This error is mapped from the translation auth:errors.{error}
 * To update the error messages, please update the translation file
 * https://github.com/supabase/gotrue-js/blob/master/src/lib/errors.ts
 */
export default ({ error }: { error: Maybe<Error | AuthError | unknown> }) => {
  if (!error) {
    return null;
  }

  const errorCode = error instanceof AuthError ? error.message : error;

  return (
    <Alert className="w-full" type="error">
      <Alert.Heading>{errorCode}</Alert.Heading>
      <p className="text-sm font-medium" data-cy="auth-error-message">
        {error.message}
      </p>
    </Alert>
  );
};
