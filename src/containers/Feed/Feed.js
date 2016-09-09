import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';
import { asyncConnect } from 'redux-connect';
import {isLoaded, load} from 'redux/modules/posts';

@asyncConnect([{
  deferred: true,
  promise: ({store: {dispatch, getState}}) => {
    if (!isLoaded(getState())) {
      return dispatch(load());
    }
  }
}])
@connect(
  state => ({data: state.posts.data})
)
export default class Feed extends Component {
  static propTypes = {
    data: PropTypes.object
  }

  renderSinglePost(post) {
    return (
      <div>
        <h3>{post.title}</h3>
        <div>{post.content}</div>
      </div>
    );
  }

  render() {
    const {data} = this.props;
    return (
      <section className="page-wrapper container">
        {data.feed.map(this.renderSinglePost)}
      </section>
    );
  }
}
