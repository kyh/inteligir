import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';
import {MegadraftEditor, editorStateFromRaw, editorStateToJSON} from 'megadraft';
import * as postActions from 'redux/modules/posts';

const styles = require('./NewPost.scss');

@connect(
  state => ({user: state.auth.user, post: state.posts}),
  postActions
)
export default class NewPost extends Component {
  static propTypes = {
    user: PropTypes.object,
    createPost: PropTypes.func
  }

  static contextTypes = {
    router: React.PropTypes.object.isRequired
  };

  constructor(props) {
    super(props);
    this.state = {
      postTitle: '',
      editorState: editorStateFromRaw(null),
    };
    this.onChange = ::this.onChange;
    this.submitPost = ::this.submitPost;
  }

  onChange(editorState) {
    this.setState({ editorState });
  }

  submitPost() {
    const { postTitle, editorState } = this.state;
    const content = editorStateToJSON(editorState);

    this.props.createPost(postTitle, content).then(() => {
      console.log('post created');
    });
  }

  render() {
    const router = this.context.router;

    return (
      <section className={styles.newPost}>
        <nav className={styles.newPostNav}>
          <button className={styles.newPostBack} onClick={router.goBack}>Back</button>
          <h1 className={styles.newPostHeaderTitle}>New Post</h1>
          <div>
            <button className={styles.newPostSave} onClick={this.submitPost}>
              Publish
            </button>
          </div>
        </nav>
        <section className={styles.newPostContentWrapper}>
          <section className={styles.newPostContent}>
            <input
              className={styles.newPostContentTitle}
              placeholder="Type your title here"
              type="text"
            />
            <MegadraftEditor
              editorState={this.state.editorState}
              onChange={this.onChange}
              placeholder="Type your post..."
            />
          </section>
        </section>
      </section>
    );
  }
}
