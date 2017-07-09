import React, { Component } from 'react';
import { reduxForm, Field, propTypes } from 'redux-form';
import loginValidation from './loginValidation';
import AuthInput from './AuthInput';

const styles = require('./LoginForm.scss');

@reduxForm({
  form: 'login',
  validate: loginValidation
})
export default class LoginForm extends Component {
  static propTypes = {
    ...propTypes
  }

  state = {
    isLoading: false
  }

  handleSubmit = () => {
    this.setState({ isLoading: true });
    this.props.handleSubmit();
  }

  render() {
    const { error } = this.props;
    return (
      <form className={styles.loginForm} onSubmit={this.handleSubmit}>
        <header className={styles.loginFormHeader}>
          <h3 className={styles.loginFormTitle}>Welcome back</h3>
        </header>
        <section className={styles.loginFormBody}>
          {
            error &&
              <span className={styles.loginErrorMessage}>{error}</span>
          }
          <Field
            name="email"
            type="text"
            component={AuthInput}
            label="Email"
          />
          <Field
            name="password"
            type="password"
            component={AuthInput}
            label="Password"
          />
          <button
            className={`${styles.loginFormSubmit} button-primary`}
            type="submit">
            Log In
          </button>
        </section>
      </form>
    );
  }
}
