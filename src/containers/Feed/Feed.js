import React, { Component, PropTypes } from 'react';
import { Post } from 'components';

const styles = require('./Feed.scss');

export default class Feed extends Component {
  static propTypes = {
    data: PropTypes.object
  }

  renderSinglePost(post) {
    return <Post key={post.id} post={post} />;
  }

  render() {
    const data = [{
      title: 'Test Post',
      content: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit. Voluptas dolor consectetur molestiae possimus tempore vitae dignissimos totam aspernatur ex eum, officia nulla, veniam fuga quisquam cumque, atque in veritatis deserunt.',
      author: 'Kai'
    }, {
      title: 'Another Post',
      content: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit. Voluptas dolor consectetur molestiae possimus tempore vitae dignissimos totam aspernatur ex eum, officia nulla, veniam fuga quisquam cumque, atque in veritatis deserunt.',
      author: 'Ming'
    }];
    return (
      <section className={styles.feed}>
        <section className={styles.feedContent}>
          {data.map(this.renderSinglePost)}
        </section>
      </section>
    );
  }
}
