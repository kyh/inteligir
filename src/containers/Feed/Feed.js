import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';

@connect(
  state => ({user: state.auth.user})
)
export default
class Profile extends Component {
  static propTypes = {
    user: PropTypes.object
  }

  render() {
    return (
      <section className="page-wrapper container">
        <h1>Feed</h1>
      </section>
    );
  }
}
