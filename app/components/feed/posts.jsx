import React, { Component, PropTypes } from 'react';

import { Link } from 'react-router';
import { IntlMixin } from 'react-intl';
import { replaceParams } from 'utils/localized-routes';

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
    const postRoute = replaceParams(
      this._getIntlMessage('routes.post'),
      { id: post.id }
    );

    return (
      <tr className='post--row' key={ index }>
        <td>{ post.post.title }</td>
        <td className='text-center'>
          <Link to={ postRoute }>Link</Link>
        </td>
      </tr>
    );
  }

  render() {
    return (
      <section>
        <table className='app--posts'>
          <tbody>
            { this.state.posts.map(this.renderPost) }
          </tbody>
        </table>
      </section>
    );
  }

}

export default Posts;
