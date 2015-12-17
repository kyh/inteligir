import React, { Component, PropTypes } from 'react';
import connect from 'connect-alt';

import Navtab from 'components/shared/navtab/navtab';
import Posts from 'components/feed/posts/posts';

import { IntlMixin } from 'react-intl';

if (process.env.BROWSER) require('./feed.css');

@connect(({ posts: { collection } }) => ({ collection }))
class Feed extends Component {

  static propTypes = { collection: PropTypes.array.isRequired }

  static contextTypes = {
    flux: PropTypes.object.isRequired,
    messages: PropTypes.object.isRequired
  }

  i18n = IntlMixin.getIntlMessage

  componentWillMount() {
    const { flux } = this.context;

    flux.getActions('helmet').update({ title: this.i18n('feed.page-title') });
    flux.getActions('posts').index();
  }

  render() {
    return (
      <section className='feed'>
        <Navtab items={ [ 'Popular', 'Design', 'Front-end Development' ] } />
        <Posts posts={ this.props.collection } />
      </section>
    );
  }
}

export default Feed;
