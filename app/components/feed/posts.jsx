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

  _removePost(index) {
    this.props.flux
      .getActions('posts')
      .remove(index);
  }

  renderPost = (post, index) => {
    const profileRoute = replaceParams(
      this._getIntlMessage('routes.profile'),
      { id: post.id }
    );
    return (
      <tr className='post--row' key={ index }>
        <td>{ post.post.email }</td>
        <td className='text-center'>
          <Link to={ profileRoute }>Profile</Link>
        </td>
        <td className='text-center'>
          <button
            className='post--remove'
            onClick={ this._removePost.bind(this, index) }>
            X
          </button>
        </td>
      </tr>
    );
  }

  render() {
    return (
      <div>
        <table className='app--posts'>
          <thead>
            <tr>
              <th>
                { this._getIntlMessage('posts.email') }
              </th>
              <th colSpan='2'>
                { this._getIntlMessage('posts.actions') }
              </th>
            </tr>
          </thead>
          <tbody>
            {
              this.state.posts
                .map(this.renderPost)
            }
          </tbody>
        </table>
        <p className='text-center'>
          <button
            className='add--button'
            onClick={ this.props.flux.getActions('posts').add }>
            { this._getIntlMessage('posts.add') }
          </button>
        </p>
      </div>
    );
  }

}

export default Posts;
