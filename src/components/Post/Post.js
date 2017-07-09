import React, { Component, PropTypes } from 'react';
import classNames from 'classnames';
const styles = require('./Post.scss');

const postAuthorText = [
  '$name\'s original idea',
  'A beautiful post by $name',
  'Written with love, $name',
  'Yet another brilliant post by $name'
];

export default class Post extends Component {
  static propTypes = {
    post: PropTypes.object.isRequired,
    onlyAbstract: PropTypes.bool
  };

  constructor(props) {
    super(props);
    const { user } = props.post;

    if (user) {
      const authorTextString = postAuthorText[Math.floor(Math.random() * postAuthorText.length)];
      this.author = authorTextString.replace('$name', user.first_name);
    }
  }

  render() {
    const { post, onlyAbstract } = this.props;
    const postClass = classNames({
      [styles.post]: true,
      [styles.postAbstract]: onlyAbstract,
    });

    return (
      <article className={postClass}>
        <span className={styles.postTag}>technology</span>
        <h3 className={styles.postTitle}>{post.title}</h3>
        {!onlyAbstract && <div className={styles.postContent}>{post.content}</div>}
        {
          this.author && !onlyAbstract &&
            <span className={styles.postAuthor}>{this.author}</span>
        }
      </article>
    );
  }
}
