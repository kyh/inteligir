import React, { Component, PropTypes } from 'react';
import Navtab from 'components/shared/navtab';
import { IntlMixin } from 'react-intl';

if (process.env.BROWSER) {
  require('components/feed/feed.css');
}

class Feed extends Component {

  static propTypes = {
    flux: PropTypes.object.isRequired
  }

  _getIntlMessage = IntlMixin.getIntlMessage

  componentWillMount() {
    this.props.flux
      .getActions('page-title')
      .set(this._getIntlMessage('feed.page-title'));

    this.props.params.listItems = [
      'popular',
      'my groups',
      'design',
      'ux group',
      'frontend'
    ];
  }

  render() {
    return (
      <section className="feed">
        <Navtab items={ this.props.params.listItems } />
        <h1>Feed</h1>
      </section>
    );
  }

}

export default Feed;
