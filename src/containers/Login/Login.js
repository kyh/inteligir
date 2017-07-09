import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import Helmet from 'react-helmet';
import { LoginForm, RegisterForm } from 'components';
import * as authActions from 'redux/modules/auth';
import * as notifActions from 'redux/modules/notifs';

const styles = require('./Login.scss');

@connect(
  () => ({}),
  { ...notifActions, ...authActions }
)
export default class Login extends Component {
  static propTypes = {
    location: PropTypes.object.isRequired,
    register: PropTypes.func.isRequired,
    login: PropTypes.func.isRequired,
    notifSend: PropTypes.func.isRequired,
  }

  static defaultProps = {
    user: null
  }

  static contextTypes = {
    router: PropTypes.object
  }

  onFacebookLogin = (err, data) => {
    if (err) return;
    this.props.login('facebook', data, false)
      .then(this.successLogin)
      .catch(error => {
        if (error.message === 'Incomplete oauth registration') {
          this.context.router.push({
            pathname: '/register',
            state: { oauth: error.data }
          });
        }
      });
  }

  getInitialValues = () => {
    const { location } = this.props;
    return location.state && location.state.oauth;
  }

  login = (data) => {
    this.props.login('local', data)
      .then(() => this.notify('Welcome back'));
  }

  register = (data) => {
    this.props.register(data)
      .then(() => this.notify('You are now registered'));
  }

  notify = (message) => {
    this.props.notifSend({
      message,
      kind: 'success',
      dismissAfter: 2000
    });
  }

  renderFacebookLoginButton = ({ facebookLogin }) => {
    return (
      <button className="btn btn-primary" onClick={facebookLogin}>
        Login with <i className="fa fa-facebook-f" />
      </button>
    );
  }

  renderForm = () => {
    if (this.props.location.pathname === '/register') {
      return (
        <RegisterForm
          onSubmit={this.register}
          initialValues={this.getInitialValues()}
        />
      );
    }
    return <LoginForm onSubmit={this.login} />;
  }

  render() {
    return (
      <section className={styles.login}>
        <Helmet title="Login" />
        {this.renderForm()}
      </section>
    );
  }
}
