class FeedStore {

  constructor() {
    this.bindActions(this.alt.getActions('feed'));
    this.posts = [];
    this.groups = [];
  }

  onSelectGroup(id) {
    console.log(id, this.getState());
  }

  onFetchSuccess(groups) {
    this.groups = groups.reduce((results, curr) => {
      const index = results.findIndex(({ id }) => id === curr.id);
      if (index > -1) {
        results[index] = curr;
        return results;
      } else {
        return [ curr, ...results ];
      }
    }, [ ...this.groups ]);
  }

}

export default FeedStore;
