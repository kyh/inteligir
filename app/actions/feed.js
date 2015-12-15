import sample from 'lodash/collection/sample';
import take from 'lodash/array/take';

import data from 'data/groups.json';

class FeedActions {

  constructor() {
    this.generateActions(
      'fetchSuccess', 'selectGroup'
    );
  }

  fetch() {
    const promise = (resolve) => {
      this.alt.getActions('requests').start();
      setTimeout(() => {
        this.actions.fetchSuccess(take(data.groups, 10));
        this.alt.getActions('requests').success();
        return resolve();
      }, 300);
    };
    this.alt.resolve(promise);
  }

  selectGroup(id) {

  }

}

export default FeedActions;
