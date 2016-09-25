import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';
import * as authActions from 'redux/modules/auth';
import {asyncConnect} from 'redux-connect';
import {loadUserPosts} from 'redux/modules/posts';
import {Post, UserProfile} from 'components';

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
    return <Post key={post.id} post={post} onlyAbstract />;
  }

  render() {
    const {user, logout, userPosts} = this.props;
    return (
      <section className="page-wrapper container">
        <UserProfile user={user} logout={logout} />
        <section>
          <h3>Your posts</h3>
          {userPosts.posts.map(this.renderSinglePost)}
        </section>
      </section>
    );
  }
}
