[![Build Status](https://travis-ci.org/inteligir/inteligir-platform.svg?branch=master)](https://travis-ci.org/inteligir/inteligir-platform)
[![Dependency Status](https://david-dm.org/inteligir/inteligir-platform/status.svg)](https://david-dm.org/inteligir/inteligir-platform)
[![Greenkeeper badge](https://badges.greenkeeper.io/inteligir/inteligir-platform.svg)](https://greenkeeper.io/)

# Inteligir

> Making open source more accessible for everyone

Two of the most prominent barriers to developers’ involvement in open source are (a) not knowing where to begin and (b) doubting they have the right skills[*](https://www.digitalocean.com/currents/october-2018/). Inteligir is here to change that.

## Directory Layout

```
├── /client                      # ReactJS client, which contains most of our UI
│   ├── /components              # React components, reusable across all pages
│   ├── /utils                   # Helper functions/Utilities/Services
│   ├── /redux                   # Redux modules
│   ├── /pages                   # App route definitions
│   └── /static                  # Static assets
│   └── next.config.js           # Next.js SSR configuration
│── /server                      # Node.js server, serves the web app as well as API endpoints
│   ├── /api                     # API routes, models, and controllers
│   ├── /config                  # Server environment variables
│   ├── /middlewares             # Express app middleware
│   ├── /services                # Server Helper functions/Utilities/Services
│   └── index.js                 # Server entry point
│── /worker                      # JavaScript worker modules
│── /science                     # DNN training and evaluation, as well as data analyses.
│── /k8s                         # K8 configuration and deployment files
└── /tests                       # Javascript tests
```

## Getting Started

Clone the repo:

```
$ git clone git@github.com:inteligir/inteligir.git .
```

We recommend using `n` to manage multiple node installs:

```bash
npm install -g n
# now we can use n to manage our node version!
n 10.14.2
# Switch versions with "n <version>"
# See datails of n here: https://github.com/tj/n
```

To setup the server:

- grab a `.inteligir_dev.key` from another contributor and move the file into `/encrypted` directory
  then run:

```bash
npm run setup
```

## Building and Running Locally

```bash
npm run build
npm start
```

You can then load: [http://localhost:5000/](http://localhost:5000/)

#### To start a dev web server with Webpack Dev Server:

```bash
npm run dev
```

This will do two things:

1.  Start the Webpack Dev Server that serves assets in the client directory (it will refresh the page on any changes)
2.  Start a nodemon server for the server directory which will watch all server files and restart the server on changes

## Deployment

#### To deploy to development or production:

```bash
npm run deploy
```

The deploy script will guide you through the rest of the deployment process.

Release tag names follow [semantic versioning](http://semver.org/) e.g.

- `v1.0.0`

## Debugging Tips

You can debug node apps by attaching an `ndb` instance to your running node server. First install the
[ndb](https://www.npmjs.com/package/ndb) package into your global environment:

```bash
npm i -g ndb
```

You can now use the node debugger to profile, add breakpoints, log errors, and even inject JavaScript
without needing to restart the server! Start the debugger by running:

```bash
make debug
```

## Style Guide

JavaScript - this project follows the [Airbnb Style Guide](https://github.com/airbnb/javascript) along with [Prettier](https://prettier.io/) formatting.
