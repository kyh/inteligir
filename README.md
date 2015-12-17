[![Dependency Status](https://david-dm.org/tehkaiyu/write.svg)](https://david-dm.org/tehkaiyu/write)
[![devDependency Status](https://david-dm.org/tehkaiyu/write/dev-status.svg)](https://david-dm.org/tehkaiyu/write#info=devDependencies)
[![NPM Version](http://img.shields.io/npm/v/tehkaiyu/write.svg?style=flat)](https://www.npmjs.com/package/tehkaiyu/write)

# Write

> Share knowledge.

## Installation

Download and install [nvm](https://github.com/creationix/nvm), then:

* `$ nvm install stable`
* `$ nvm use stable`
* `$ nvm alias default stable`

Use with `nodejs^4.x`, clone the repo, `npm install` and `npm run dev`.

Learn React ([react-prime-draft](https://github.com/mikechau/react-primer-draft)), learn Flux and Alt ([alt guide](http://alt.js.org/guide/)).

## Concepts

**Koa** will be our server for the server side rendering, we use **alt** for our Flux architecture and **react-router** for routing in our app.

With **iso** as helper we can populate **alt** flux stores before the first rendering and have a complete async isomorphic React application.

## Flux

[Alt](http://alt.js.org) instance as [Flux](http://facebook.github.io/react/blog/2014/05/06/flux.html) implementation.

We need to use instances for isomorphic applications, to have a unique store/actions per requests on the server.

## Async data-fetching

Alt-resolver will be our tool for resolving promises (data-fetching) before server side rendering.

Wrap data-fetching requests from actions into promises and send them to `altResolver` like:

```javascript
show(id) {
  // You need to return a fn in actions
  // to get alt instance as second parameter to access
  // `alt-resolver` and the ApiClient
  return (dispatch, { resolve, request  }) =>
  // We use `alt-resolver` from the boilerplate
  // to indicate the server we need to resolve
  // this data before server side rendering
    resolve(async () => {
      try {
        const response = await request({ url: '/users' });
        this.actions.indexSuccess(response);
      } catch (error) {
        this.actions.indexFail({ error });
      }
    });
}
```

Call the fetch action from component in the `componentWillMount` method:

```javascript
import React, { Component, PropTypes } from 'react';
import connect from 'connect-alt';

// connect-alt is an util to connect store state to component props
// you can read more about it here: http://github.com/iam4x/connect-alt
// it handle store changes for you :)
//
// posts -> store name
// collection -> `this.collection` into posts store
//
@connect(({ posts: { collection } }) => ({ posts: collection }))
class Posts extends Component {

  static contextTypes: { flux: PropTypes.object.isRequired }
  static propTypes: { posts: PropTypes.array.isRequired }

  componentWillMount() {
    const { flux } = this.context
    return flux.getActions('posts').fetch();
  }

  render() {
    const { posts } = this.props;
    return (<pre>{ JSON.stringify(posts, null, 4) }</pre>)
  }
}
```

On browser side, the rendering won't be stopped and will resolve the promise instantly.

On server side, `altResolver.render` will fire a first render to collect all the promises needed for a complete rendering. It will then resolve them, and try to re-render the application for a complete markup.

Open `app/actions/posts.js`, `app/utils/alt-resolver.js`, `app/stores/posts.js` for more information about data-fetching.

### Run in production

Build the project first:

* `$ npm run build`

Then start the koa server:

* `$ NODE_ENV=production node server/index.js`

You can also use `processes.json` to run the application with [PM2 Monitor](https://github.com/Unitech/pm2) on the production server:

* `$ pm2 start processes.json`

## Libraries Used

* [react](https://facebook.github.io/react/)
* [react-router](https://github.com/rackt/react-router)
* [react-intl](https://github.com/yahoo/react-intl)
* [react-redbox](https://github.com/KeywordBrain/redbox-react)
* [alt](https://github.com/goatslacker/alt)
* [iso](https://github.com/goatslacker/iso)
* [koa](http://koajs.com/)
* [webpack](http://webpack.github.io/)
* [webpack-hot-middleware](https://github.com/glenjamin/webpack-hot-middleware)
* [webpack-dev-middleware](https://github.com/webpack/webpack-dev-middleware)
* [babeljs](https://babeljs.io/)
* [cssnext](http://cssnext.io/)

### Learn more

* [Official ReactJS website](http://facebook.github.io/react/)
* [Official ReactJS wiki](https://github.com/facebook/react/wiki)
* [Official Flux website](http://facebook.github.io/flux/)
* [ReactJS Conf 2015 links](https://gist.github.com/yannickcr/148110d3ca658ad96c2b)
* [Learn ES6](https://babeljs.io/docs/learn-es6/)
* [ES6 Features](https://github.com/lukehoban/es6features#readme)
