import React, { Component, PropTypes } from 'react';
import { connect } from 'react-redux';
import Helmet from 'react-helmet';
import { Navigation } from 'components';
import { logout } from 'redux/modules/auth';
import { push } from 'react-router-redux';
import config from '../../config';

require('./App.scss');

@connect(
  state => ({user: state.auth.user}),
  {logout, pushState: push}
)
export default class App extends Component {
  static propTypes = {
    children: PropTypes.object.isRequired,
    user: PropTypes.object,
    logout: PropTypes.func.isRequired,
    pushState: PropTypes.func.isRequired
  };

  static contextTypes = {
    store: PropTypes.object.isRequired
  };

  componentWillReceiveProps(nextProps) {
    if (!this.props.user && nextProps.user) {
      // login
      this.props.pushState('/profile');
    } else if (this.props.user && !nextProps.user) {
      // logout
      this.props.pushState('/');
    }
  }

  render() {
    const {user} = this.props;

    return (
      <section>
        <Helmet {...config.app.head}/>
        <Navigation user={user} logout={this.props.logout} />
        {this.props.children}
      </section>
    );
  }
}
