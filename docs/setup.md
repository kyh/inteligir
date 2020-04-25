# Setup Inteligir locally

### Foreword

If you see a step below that could be improved (or is outdated), please update the instructions. I rarely go through this process myself, so your fresh pair of eyes and your recent experience with it, makes you the best candidate to improve them for other users. Thank you!

### Prerequisite

1. Make sure you have Node.js version >= 10.

- We recommend using [nvm](https://github.com/creationix/nvm): `nvm use`.

2. You'll need the [Postgres](https://www.postgresql.org/):

### Getting Started

Inteligir is written in TypeScript with [Next.js](https://nextjs.org/)\*\* using [React](https://reactjs.org/), [Apollo Client](https://www.apollographql.com/docs/react/) (frontend), [GraphQL Nexus](https://nexus.js.org/) and [Prisma Client](https://github.com/prisma/prisma2/blob/master/docs/prisma-client-js/api.md) (backend).

#### How to install

We recommend cloning the repository in a folder dedicated to `Inteligir` projects.

```
git clone git@github.com:/tehkaiyu/inteligir.git ys/app
cd ys/app
npm install
```

Note that this also generates Prisma Client JS into `node_modules/@prisma/client` via a `postinstall` hook of the `@prisma/client` package from your `package.json`.

### Building and Running Locally

#### To start a dev web server:

```
npm run dev
```

The app is now running, navigate to [`http://localhost:3000/`](http://localhost:3000/) in your browser to explore its UI.

#### To build a production version of the app:

```bash
npm run build
npm start
```

You can then load: [http://localhost:5000/](http://localhost:5000/)

## Deployment

To deploy to staging or production, you need to be a core member of the Inteligir team.

#### To deploy to development or production:

Deployments happens automatically when a pull request gets merged into master

## Debugging Tips

You can debug node apps by attaching an `ndb` instance to your running node server. First install the
[ndb](https://www.npmjs.com/package/ndb) package into your global environment:

```bash
npm i -g ndb
```

You can now use the node debugger to profile, add breakpoints, log errors, and even inject JavaScript
without needing to restart the server! Start the debugger by running:

```bash
npm run debug
```

## Style Guide

This project uses [Prettier](https://prettier.io/) formatting.
