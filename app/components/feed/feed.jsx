import React, { Component, PropTypes } from 'react';
import connect from 'connect-alt';

import Navtab from 'components/shared/navtab/navtab';
import Posts from 'components/feed/posts/posts';

import { IntlMixin } from 'react-intl';

if (process.env.BROWSER) require('./feed.css');

@connect(({ posts: { collection } }) => ({ collection }))
class Feed extends Component {

  static propTypes = { collection: PropTypes.array.isRequired }

  static contextTypes = {
    flux: PropTypes.object.isRequired,
    messages: PropTypes.object.isRequired
  }

  i18n = IntlMixin.getIntlMessage

  componentWillMount() {
    const { flux } = this.context;

    flux.getActions('helmet').update({ title: this.i18n('feed.page-title') });
    flux.getActions('posts').index();
  }

  render() {
    return (
      <section className='feed'>
        <Navtab items={ [ '1', 'two' ] } />
        <Posts posts={ this.props.collection } />
      </section>
    );
  }
}

// <Posts />

// render() {
//   const { collection } = this.props;

//   return (
//     <div>
//       <h1 className='text-center'>
//         { this.i18n('users.title') }
//       </h1>
//       <table className='app--users'>
//         <thead>
//           <tr>
//             <th> { this.i18n('users.email') } </th>
//             <th colSpan='2'> { this.i18n('users.actions') } </th>
//           </tr>
//         </thead>
//         <tbody>
//           { collection.map(this.renderUser) }
//         </tbody>
//       </table>
//     </div>
//   );
// }

export default Feed;
