import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import TextField from "@inteligir/ui/text-field";
import Button from "@inteligir/ui/button";

const EmailPasswordSignUpForm: React.FCC<{
  onSubmit: (params: {
    email: string;
    password: string;
    repeatPassword: string;
  }) => unknown;
  loading: boolean;
}> = ({ onSubmit, loading }) => {
  const { t } = useTranslation();

  const { register, handleSubmit, watch, formState } = useForm({
    defaultValues: {
      email: "",
      password: "",
      repeatPassword: "",
    },
  });

  const emailControl = register("email", { required: true });
  const errors = formState.errors;

  const passwordControl = register("password", {
    required: true,
    minLength: {
      value: 6,
      message: t(`auth:passwordLengthError`),
    },
  });

  const passwordValue = watch(`password`);

  const repeatPasswordControl = register("repeatPassword", {
    required: true,
    minLength: {
      value: 6,
      message: t(`auth:passwordLengthError`),
    },
    validate: (value) => {
      if (value !== passwordValue) {
        return t(`auth:passwordsDoNotMatch`);
      }

      return true;
    },
  });

  return (
    <form className="w-full" onSubmit={handleSubmit(onSubmit)}>
      <div className="flex-col space-y-4">
        <TextField>
          <TextField.Label>
            Email Address
            <TextField.Input
              {...emailControl}
              data-cy="email-input"
              placeholder="your@email.com"
              required
              type="email"
            />
          </TextField.Label>

          <TextField.Error error={errors.email?.message} />
        </TextField>

        <TextField>
          <TextField.Label>
            Password
            <TextField.Input
              {...passwordControl}
              data-cy="password-input"
              placeholder=""
              required
              type="password"
            />
            <TextField.Hint>Ensure it's at least 6 characters</TextField.Hint>
            <TextField.Error
              data-cy="password-error"
              error={errors.password?.message}
            />
          </TextField.Label>
        </TextField>

        <TextField>
          <TextField.Label>
            Repeat password
            <TextField.Input
              {...repeatPasswordControl}
              data-cy="repeat-password-input"
              placeholder=""
              required
              type="password"
            />
            <TextField.Hint>Type your password again</TextField.Hint>
            <TextField.Error
              data-cy="repeat-password-error"
              error={errors.repeatPassword?.message}
            />
          </TextField.Label>
        </TextField>

        <div>
          <Button
            className="w-full"
            data-cy="auth-submit-button"
            loading={loading}
            type="submit"
          >
            Get started
          </Button>
        </div>
      </div>
    </form>
  );
};

export default EmailPasswordSignUpForm;
