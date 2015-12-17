class PostsStore {

  constructor() {
    this.bindActions(this.alt.getActions('posts'));

    this.collection = [];
    this.error = null;
  }


  onIndexSuccess(posts) {
    this.collection = posts;
    this.error = null;
  }

  onIndexFail({ error }) {
    this.error = error;
  }

  onShowSuccess(posts) {
    const index = this.collection
      .findIndex(({ id }) => id === posts.id);

    if (index > -1) {
      this.collection = this.collection
        .map((u, idx) => idx === index ? posts : u);
    } else {
      this.collection = [ ...this.collection, posts ];
    }

    this.error = null;
  }

  onShowFail({ error }) {
    this.error = error;
  }

  onRemove(index) {
    this.collection = this.collection
      .filter((posts, idx) => idx !== index);
  }

}

export default PostsStore;
