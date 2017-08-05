import React, { Component } from 'react';
import { reduxForm, Field, propTypes } from 'redux-form';
import registerValidation from './registerValidation';
import AuthInput from './AuthInput';

const styles = require('./LoginForm.scss');

@reduxForm({
  form: 'register',
  validate: registerValidation
})
export default class RegisterForm extends Component {
  static propTypes = {
    ...propTypes
  }

  state = {
    isLoading: false
  }

  handleSubmit = (event) => {
    event.preventDefault();
    this.setState({ isLoading: true });
    this.props.handleSubmit();
  }

  render() {
    const { error } = this.props;

    return (
      <form
        className={styles.loginForm}
        onSubmit={this.handleSubmit}
      >
        <header className={styles.loginFormHeader}>
          <h3 className={styles.loginFormTitle}>Let's get you started</h3>
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
          <Field
            label="Password confirmation"
            type="password"
            name="password_confirmation"
            component={AuthInput}
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
