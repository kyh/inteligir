import { useForm } from "react-hook-form";
import Button from "~/components/Button";
import If from "~/components/If";
import { TextField } from "~/components/TextField";

const EmailPasswordSignUpForm: React.FCC<{
  onSubmit: (params: {
    email: string;
    password: string;
    repeatPassword: string;
  }) => unknown;
  loading: boolean;
}> = ({ onSubmit, loading }) => {
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
      message: "Password must be at least 6 characters long",
    },
  });

  const passwordValue = watch(`password`);

  const repeatPasswordControl = register("repeatPassword", {
    required: true,
    minLength: {
      value: 6,
      message: "Password must be at least 6 characters long",
    },
    validate: (value) => {
      if (value !== passwordValue) {
        return "Passwords do not match";
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
              required
              type="email"
              placeholder="your@email.com"
            />
            <If condition={errors.email}>
              <TextField.Hint color="error">
                {errors.email?.message}
              </TextField.Hint>
            </If>
          </TextField.Label>
        </TextField>

        <TextField>
          <TextField.Label>
            Password
            <TextField.Input
              {...passwordControl}
              data-cy="password-input"
              required
              type="password"
              placeholder=""
            />
            <TextField.Hint>Ensure it's at least 6 characters</TextField.Hint>
            <If condition={errors.password}>
              <TextField.Hint color="error">
                {errors.password?.message}
              </TextField.Hint>
            </If>
          </TextField.Label>
        </TextField>

        <TextField>
          <TextField.Label>
            Repeat password
            <TextField.Input
              {...repeatPasswordControl}
              data-cy="repeat-password-input"
              required
              type="password"
              placeholder=""
            />
            <TextField.Hint>Type your password again</TextField.Hint>
            <If condition={errors.repeatPassword}>
              <TextField.Hint color="error">
                {errors.repeatPassword?.message}
              </TextField.Hint>
            </If>
          </TextField.Label>
        </TextField>

        <div>
          <Button
            data-cy="auth-submit-button"
            className="w-full"
            color="primary"
            type="submit"
            loading={loading}
          >
            <If condition={loading} fallback="Get started">
              Signing up...
            </If>
          </Button>
        </div>
      </div>
    </form>
  );
};

export default EmailPasswordSignUpForm;
