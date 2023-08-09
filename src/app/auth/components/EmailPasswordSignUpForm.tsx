import { useForm } from "react-hook-form";
import { Button } from "~/components/Button";
import { If } from "~/components/If";
import { TextField } from "~/components/TextField";

const EmailPasswordSignUpForm: React.FCC<{
  onSubmit: (params: { email: string; password: string }) => unknown;
  loading: boolean;
}> = ({ onSubmit, loading }) => {
  const { register, handleSubmit, formState } = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const emailControl = register("email", { required: true });
  const passwordControl = register("password", {
    required: true,
    minLength: {
      value: 6,
      message: "Password must be at least 6 characters long",
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
            <If condition={formState.errors.email}>
              <TextField.Hint color="error">
                {formState.errors.email?.message}
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
            <TextField.Hint>
              Ensure it&apos;s at least 6 characters
            </TextField.Hint>
            <If condition={formState.errors.password}>
              <TextField.Hint color="error">
                {formState.errors.password?.message}
              </TextField.Hint>
            </If>
          </TextField.Label>
        </TextField>
        <div>
          <Button
            data-cy="auth-submit-button"
            className="w-full"
            type="submit"
            loading={loading}
          >
            Get started
          </Button>
        </div>
      </div>
    </form>
  );
};

export default EmailPasswordSignUpForm;
