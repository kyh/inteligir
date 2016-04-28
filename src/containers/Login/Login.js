import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';
import Helmet from 'react-helmet';
import * as authActions from 'redux/modules/auth';

@connect(
  state => ({user: state.auth.user}),
  authActions)
export default class Login extends Component {
  static propTypes = {
    user: PropTypes.object,
    login: PropTypes.func,
    logout: PropTypes.func
  }

  handleSubmit = (event) => {
    event.preventDefault();
    const input = this.refs.username;
    this.props.login(input.value);
    input.value = '';
  }

  render() {
    const {user, logout} = this.props;
    const styles = require('./Login.scss');

    return (
      <section>
        <Helmet title="Login"/>
        {!user &&
        <section className={styles.login}>
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
        }

        {user &&
        <section className={styles.login}>
          <form className={styles.loginForm}>
            <header className={styles.loginFormHeader}>
              <h3 className={styles.loginFormTitle}>You are currently logged in as {user.name}.</h3>
            </header>
            <section className={styles.loginFormBody}>
              <button
                className={styles.loginFormSubmit}
                onClick={logout}>
                Log Out
              </button>
            </section>
          </form>
        </section>
        }
      </section>
    );
  }
}
