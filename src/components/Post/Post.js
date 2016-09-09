import React, { Component, PropTypes } from 'react';
// const styles = require('./Post.scss');

export default class Post extends Component {
  static propTypes = {
    post: PropTypes.object
  };

  render() {
    const {post} = this.props;

    return (
      <div key={post.id}>
        <h3>{post.title}</h3>
        <div>{post.content}</div>
      </div>
    );
  }
}
