import React, { useState } from 'react';
import useForm from 'react-hook-form';
import { withStyles } from '@material-ui/core/styles';

import { useLogin } from '@hooks/login';
import { useSignup } from '@hooks/signup';

import { emailValidation } from '@utils/validation';
import redirect from '@utils/redirect';

import { TextField, Button, Snackbar } from '@components';

const styles = (theme) => ({
  field: { marginBottom: theme.spacing(2) },
});

function AuthForm({ isLoginForm, classes }) {
  const { register, errors, handleSubmit } = useForm({
    mode: 'onBlur',
  });
  const [loginState, setLoginState] = useState({
    isLoading: false,
    isErrorOpen: false,
    errorMessage: '',
  });
  const [authFunction] = isLoginForm ? useLogin() : useSignup();

  const onSubmit = (data) => {
    setLoginState({
      isLoading: true,
      isErrorOpen: false,
      errorMessage: '',
    });
    const variables = { email: data.email, password: data.password };
    authFunction({ variables })
      .then(() => {
        redirect({}, '/');
      })
      .catch((error) => {
        setLoginState({
          isLoading: false,
          isErrorOpen: true,
          errorMessage: error.message,
        });
      });
  };

  return (
    <>
      <Snackbar
        open={loginState.isErrorOpen}
        variant="error"
        message={loginState.errorMessage}
        onClose={() => setLoginState({ isErrorOpen: false, errorMessage: '' })}
      />
      <form onSubmit={handleSubmit(onSubmit)}>
        <TextField
          id="email"
          name="email"
          label="Email"
          className={classes.field}
          helperText={errors.email && "This email doesn't look right."}
          error={!!errors.email}
          inputRef={register({ required: true, pattern: emailValidation })}
        />
        <TextField
          id="password"
          name="password"
          type="password"
          label="Password"
          className={classes.field}
          helperText={errors.password && 'Password is required'}
          error={!!errors.password}
          inputRef={register({ required: true })}
        />
        <footer className={classes.footer}>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            size="large"
            fullWidth
            isLoading={loginState.isLoading}
          >
            {isLoginForm ? 'Login' : 'Sign Up'}
          </Button>
        </footer>
      </form>
    </>
  );
}

export default withStyles(styles)(AuthForm);
