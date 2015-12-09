import React, { Component, PropTypes } from 'react';

import { Link } from 'react-router';
import { IntlMixin } from 'react-intl';
import { replaceParams } from 'utils/localized-routes';

if (process.env.BROWSER) {
  require('components/feed/posts/posts.css');
}

class Posts extends Component {

  static propTypes = {
    flux: PropTypes.object.isRequired
  }

  _getIntlMessage = IntlMixin.getIntlMessage

  state = this.props.flux
    .getStore('posts')
    .getState()

  componentWillMount() {
    this.props.flux
      .getActions('posts')
      .fetch();
  }

  componentDidMount() {
    this.props.flux
      .getStore('posts')
      .listen(this._handleStoreChange);
  }

  componentWillUnmount() {
    this.props.flux
      .getStore('posts')
      .unlisten(this._handleStoreChange);
  }

  _handleStoreChange = (state) => {
    return this.setState(state);
  }

  renderPost = (post, index) => {
    var postContent = post.post;
    return (
      <article className="post-preview" key={ index }>
        <Link to={ `/${post.id}` }>
          <h3 className="post-preview--title">{ postContent.title }</h3>
          <p className="post-preview--content">{ postContent.content }</p>
        </Link>
        <div className="post-preview--footer">
          <span className="date">{ postContent.posted_on }</span>
        </div>
      </article>
    );
  }

  render() {
    return (
      <section className="posts">
        { this.state.posts.map(this.renderPost) }
      </section>
    );
  }

}

export default Posts;
