import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';
import {asyncConnect} from 'redux-connect';
import {load} from 'redux/modules/posts';
import {Post} from 'components';

@asyncConnect([{
  promise: ({store: {dispatch}}) => dispatch(load())
}])
@connect(
  state => ({data: state.posts.data})
)
export default class Feed extends Component {
  static propTypes = {
    data: PropTypes.object
  }

  renderSinglePost(post) {
    return <Post post={post} />;
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
