import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';

const styles = require('./NewPost.scss');

@connect(
  state => ({user: state.auth.user})
)
export default class NewPost extends Component {
  static propTypes = {
    user: PropTypes.object,
  }

  render() {
    return (
      <div className={styles.newPost}>
        <nav className={styles.newPostNav}>
          Post Nav
        </nav>
        <section className={styles.newPostContent}>
          <h1>New Post</h1>
        </section>
      </div>
    );
  }
}
