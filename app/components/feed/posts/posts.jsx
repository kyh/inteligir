import React, { Component, PropTypes } from 'react';

import { Link } from 'react-router';

if (process.env.BROWSER) require('./posts.css');

class Posts extends Component {

  static propTypes = { posts: PropTypes.array.isRequired }

  renderPost = (post, index) => {
    return (
      <article className='post-preview' key={ index }>
        <Link to={ `/${post.id}` }>
          <h3 className='post-preview--title'>{ post.title }</h3>
          <p className='post-preview--content'>{ post.content }</p>
        </Link>
        <div className='post-preview--footer'>
          <span className='date'>September 9</span>
        </div>
      </article>
    );
  }

  render() {
    return (
      <section className='posts'>
        { this.props.posts.map(this.renderPost) }
      </section>
    );
  }
}

export default Posts;
