import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import * as authActions from 'redux/modules/auth';
import { UserProfile } from 'components';

@connect(
  state => ({ user: state.auth.user }),
  authActions
)
export default class Profile extends Component {
  static propTypes = {
    user: PropTypes.object.isRequired,
    logout: PropTypes.func.isRequired
  }

  render() {
    const { user, logout } = this.props;
    return (
      <section className="page-wrapper container">
        <UserProfile user={user} logout={logout} />
      </section>
    );
  }
}

