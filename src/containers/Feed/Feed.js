import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';
import {asyncConnect} from 'redux-connect';
import {load} from 'redux/modules/posts';
import {Post} from 'components';

const styles = require('./Feed.scss');

@asyncConnect([{
  promise: ({store: {dispatch}}) => dispatch(load())
}])
@connect(
  state => ({data: state.posts.feed})
)
export default class Feed extends Component {
  static propTypes = {
    data: PropTypes.object
  }

  renderSinglePost(post) {
    return <Post key={post.id} post={post} />;
  }

  render() {
    const {data} = this.props;
    return (
      <section className={styles.feed}>
        <section className={styles.feedContent}>
          {data.feed.map(this.renderSinglePost)}
        </section>
      </section>
    );
  }
}
