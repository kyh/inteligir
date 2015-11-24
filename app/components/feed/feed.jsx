import React, { Component, PropTypes } from 'react';

import Navtab from 'components/shared/navtab/navtab';
import Posts from 'components/feed/posts/posts';

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
        <Posts {...this.props} flux={ this.props.flux } />
      </section>
    );
  }

}

export default Feed;
