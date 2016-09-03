import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';
import Helmet from 'react-helmet';
import * as authActions from 'redux/modules/auth';

const styles = require('./Login.scss');

@connect(
  null,
  authActions)
export default class Login extends Component {
  static propTypes = {
    login: PropTypes.func,
    logout: PropTypes.func
  }

  handleSubmit = (event) => {
    event.preventDefault();
    const input = this.refs.email;
    this.props.login(input.value);
    input.value = '';
  }

  render() {
    return (
      <section className={styles.login}>
        <Helmet title="Login"/>
        <form className={styles.loginForm} onSubmit={this.handleSubmit}>
          <header className={styles.loginFormHeader}>
            <h3 className={styles.loginFormTitle}>Welcome back</h3>
          </header>
          <section className={styles.loginFormBody}>
            <section className={styles.loginFormInputWrapper}>
              <input
                type="email"
                ref="email"
                placeholder="Email"
                className={styles.loginFormInput}
              />
            </section>
            <section className={styles.loginFormInputWrapper}>
              <input
                type="password"
                ref="password" placeholder="Password"
                className={styles.loginFormInput}
              />
            </section>
            <button
              className={styles.loginFormSubmit}
              onClick={this.handleSubmit}>
              Log In
            </button>
          </section>
        </form>
      </section>
    );
  }
}
