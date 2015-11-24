import React, { Component, PropTypes } from 'react';
import { IntlMixin } from 'react-intl';
import capitalize from 'lodash/string/capitalize';

class Post extends Component {

  static propTypes = {
    flux: PropTypes.object.isRequired,
    params: PropTypes.object.isRequired
  }

  _getIntlMessage = IntlMixin.getIntlMessage
  _formatMessage = IntlMixin.formatMessage.bind(Object.assign({}, this, IntlMixin))

  state = this.props.flux
    .getStore('posts')
    .getByID(this.props.params.id)

  componentWillMount() {
    this._setPageTitle();

    this.props.flux
      .getActions('posts')
      .fetchByID(this.props.params.id);
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

  _handleStoreChange = () => {
    const user = this.props.flux
      .getStore('posts')
      .getByID(this.props.params.id);

    this.setState(user);
    this._setPageTitle();
  }

  _setPageTitle = () => {
    let title;
    if (this.state.user) {
      const user = this.state.user.user;
      const fullName = this._getFullName(user.name);

      title = this._getIntlMessage('post.page-title');
      title = this._formatMessage(title, { fullName });
    } else {
      title = this._getIntlMessage('post.not-found-page-title');
    }

    // Set page title
    this.props.flux
      .getActions('page-title')
      .set.defer(title);
  }

  _getFullName({ first, last }) {
    return `${capitalize(first)} ${capitalize(last)}`;
  }

  render() {
    if (this.state.user) {
      const user = this.state.user.user;
      return (
        <div className='app--profile text-center'>
          <h2>{ this._getFullName(user.name) }</h2>
          <img
            src={ user.picture.medium }
            alt='profile picture' />
        </div>
      );
    }

    return (
      <h2>User not found</h2>
    );
  }

}

export default Post;
