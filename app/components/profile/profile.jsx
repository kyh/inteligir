import React, { Component, PropTypes } from 'react';
import { IntlMixin } from 'react-intl';

class Profile extends Component {

  static propTypes = {
    flux: PropTypes.object.isRequired
  }

  _getIntlMessage = IntlMixin.getIntlMessage

  componentWillMount() {
    this.props.flux
      .getActions('page-title')
      .set(this._getIntlMessage('profile.page-title'));
  }

  render() {
    return (
      <section>
        <h1>Profile</h1>
      </section>
    );
  }

}

export default Profile;
