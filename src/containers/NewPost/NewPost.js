import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';
import {MegadraftEditor, editorStateFromRaw} from 'megadraft';

const styles = require('./NewPost.scss');

@connect(
  state => ({user: state.auth.user})
)
export default class NewPost extends Component {
  static propTypes = {
    user: PropTypes.object
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
  }

  onChange(editorState) {
    this.setState({ editorState });
  }

  render() {
    const router = this.context.router;

    return (
      <section className={styles.newPost}>
        <nav className={styles.newPostNav}>
          <button className={styles.newPostBack} onClick={router.goBack}>Back</button>
          <h1 className={styles.newPostHeaderTitle}>New Post</h1>
          <div>
            <button className={styles.newPostSave}>Publish</button>
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
