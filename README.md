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

```
fetch() {
  const promise = (resolve) => {
    request
      .get('http://example.com/api/posts')
      .end((response) => {
        // fire new action to send data to store
        this.actions.fetchSuccess(response.body);
        return resolve();
      });
  };
  // Send the `promise` to altResolver
  this.alt.resolve(promise);
}
```

Call the fetch action from `componentWillMount` method:

```
componentWillMount() {
  const postsActions = this.props.flux.getActions('posts');
  return postsActions.fetch();
}
```

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
