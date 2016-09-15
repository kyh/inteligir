import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';
import * as authActions from 'redux/modules/auth';
import {asyncConnect} from 'redux-connect';
import {loadUserPosts} from 'redux/modules/posts';
import {Post} from 'components';

@asyncConnect([{
  promise: ({store: {dispatch}}) => dispatch(loadUserPosts())
}])
@connect(
  state => ({
    user: state.auth.user,
    userPosts: state.posts.userPosts
  }),
  authActions
)
export default class Profile extends Component {
  static propTypes = {
    user: PropTypes.object,
    logout: PropTypes.func,
    userPosts: PropTypes.object
  }

  renderSinglePost(post) {
    return <Post key={post.id} post={post} />;
  }

  render() {
    const {user, logout, userPosts} = this.props;
    return (
      <section className="page-wrapper container">
        <h1>Hi, {user.first_name}</h1>
        <p>Kai is working on this page... Must work faster.</p>
        <section>
          {userPosts.posts.map(this.renderSinglePost)}
        </section>
        <button onClick={logout}>Log Out</button>
      </section>
    );
  }
}
