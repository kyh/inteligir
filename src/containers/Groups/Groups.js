import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';

@connect(
  state => ({user: state.auth.user}),
)
export default class Profile extends Component {
  static propTypes = {
    user: PropTypes.object,
  }

  render() {
    return (
      <div className="page-wrapper container">
        <h1>Groups</h1>
        <p>Kai is working on this page... Must work faster.</p>
      </div>
    );
  }
}
