import React, { Component, PropTypes } from 'react';
import { IntlMixin } from 'react-intl';

class Groups extends Component {

  static propTypes = {
    flux: PropTypes.object.isRequired
  }

  _getIntlMessage = IntlMixin.getIntlMessage

  componentWillMount() {
    this.props.flux
      .getActions('page-title')
      .set(this._getIntlMessage('groups.page-title'));
  }

  render() {
    return (
      <section>
        <h1>Groups</h1>
      </section>
    );
  }

}

export default Groups;
