import React, { useState } from 'react'
import { useApolloClient } from '@apollo/react-hooks'
import { useForm } from 'react-hook-form'
import { makeStyles } from '@material-ui/core/styles'

import {
  useLoginMutation,
  useSignupMutation,
} from '@features/auth/auth.graphql'

import { emailValidation } from '@utils/validation'
import redirect from '@utils/redirect'

import { TextField, Button, Snackbar } from '@components'

const useStyles = makeStyles((theme) => ({
  field: { marginBottom: theme.spacing(2) },
}))

const AuthForm = ({ isLoginForm = false }) => {
  const classes = useStyles()
  const client = useApolloClient()
  const { register, errors, handleSubmit } = useForm({
    mode: 'onBlur',
  })
  const [loginState, setLoginState] = useState({
    isLoading: false,
    isErrorOpen: false,
    errorMessage: '',
  })
  const [authFunction] = isLoginForm ? useLoginMutation() : useSignupMutation()

  const onSubmit = async (data: any) => {
    const variables = { email: data.email, password: data.password }
    setLoginState({
      isLoading: true,
      isErrorOpen: false,
      errorMessage: '',
    })
    try {
      await authFunction({ variables })
      client.resetStore()
      redirect({}, '/')
    } catch ({ graphQLErrors }) {
      const [error] = graphQLErrors
      setLoginState({
        isLoading: false,
        isErrorOpen: true,
        errorMessage: error.message,
      })
    }
  }

  return (
    <>
      <Snackbar
        open={loginState.isErrorOpen}
        variant="error"
        message={loginState.errorMessage}
        onClose={() =>
          setLoginState({
            isErrorOpen: false,
            errorMessage: '',
            isLoading: false,
          })
        }
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
        <footer>
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
  )
}

export default AuthForm
