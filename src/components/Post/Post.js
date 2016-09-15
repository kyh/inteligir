import React, { Component, PropTypes } from 'react';
const styles = require('./Post.scss');

const postAuthorText = [
  '$name\'s original idea',
  'A beautiful post by $name',
  'Written with love, $name',
  'Yet another brilliant post by $name'
];

export default class Post extends Component {
  static propTypes = {
    post: PropTypes.object
  };

  constructor(props) {
    super(props);
    const {user} = props.post;

    if (user) {
      const authorTextString = postAuthorText[Math.floor(Math.random() * postAuthorText.length)];
      this.author = authorTextString.replace('$name', user.first_name);
    }
  }

  render() {
    const {post} = this.props;

    return (
      <article className={styles.post}>
        <span className={styles.postTag}>technology</span>
        <h3 className={styles.postTitle}>{post.title}</h3>
        <div className={styles.postContent}>{post.content}</div>
        {this.author && <span className={styles.postAuthor}>{this.author}</span>}
      </article>
    );
  }
}
