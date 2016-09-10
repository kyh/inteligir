import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';
import * as authActions from 'redux/modules/auth';

@connect(
  state => ({user: state.auth.user}),
  authActions
)
export default
class Profile extends Component {
  static propTypes = {
    user: PropTypes.object,
    logout: PropTypes.func
  }

  render() {
    const {user, logout} = this.props;
    return (
      <section className="page-wrapper container">
        <h1>Hi, {user.first_name}</h1>
        <p>Kai is working on this page... Must work faster.</p>
        <button onClick={logout}>Log Out</button>
      </section>
    );
  }
}
