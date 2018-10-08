[![Build Status](https://travis-ci.org/Inteligir/Inteligir.svg?branch=master)](https://travis-ci.org/Inteligir/Inteligir)
[![Greenkeeper badge](https://badges.greenkeeper.io/Inteligir/Inteligir.svg)](https://greenkeeper.io/)

# Inteligir

> The web is a educational medium. Inteligir is a platform to build interactive visual explanations.

#### What do you mean by visual explaining?

We uses a technique on the web called scrollytelling. Scrollytelling is a way of storytelling where content unfolds as a user scrolls. Some examples in the wild:

- [R2D3](http://www.r2d3.us/visual-intro-to-machine-learning-part-1/)
- [Waveforms](https://pudding.cool/2018/02/waveforms/)
- [Differences in how news outlets cover the news](https://pudding.cool/2018/01/chyrons/)

## Directory Layout

```
├── /client                      # [ReactJS client](app/README.md), which contains most of our UI
│   ├── /src
│   │   ├── /components          # React components, reusable across all pages
│   │   ├── /util                # Helper functions/Utilities/Services
│   │   ├── /redux               # Redux modules
│   │   ├── /routes              # App route definitions
│   │   └── /styles              # Global app styles
│   └── index.js                 # Web client entry point
│── /server                      # NodeJS server
│   ├── /api                     # Inteligir API routes, models, and controllers
│   ├── /config                  # Server environment variables
│   ├── /middlewares             # Express app middleware
│   ├── /services                # Server helper functions/Utilities/Services
│   └── index.js                 # Server entry point
│── /science                     # Deep neural network training and evaluation, as well as data analyses.
└── /test                        # Javascript tests
```

## Getting Started

Clone the repo:

```
$ git clone git@github.com:Inteligir/Inteligir.git .
```

We recommend using `n` to manage multiple node installs:

```bash
npm install -g n
# now we can use n to manage our node version!
n 8.12.0
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
2.  Start a nodemon server for the server directory which will watch all server files

## Deployment

#### To deploy to dev server or production:

```bash
npm run deploy
```

The deploy script will guide you through the rest of the deployment process.

Release tag names follow [semantic versioning](http://semver.org/) e.g.

- `v1.0.0`

## Style Guide

JavaScript - this project follows the [Airbnb Style Guide](https://github.com/airbnb/javascript) along with [Prettier](https://prettier.io/) formatting.

#### Sublime text

Make sure you have [Package Control](https://packagecontrol.io/installation) installed on your Sublime Text. This will allow us to automatically install extensions needed to syntax highlight directly in your editor.

To get syntax highlighting to work on Sublime you'll want to install the following packages:

- [Babel Sublime](https://github.com/babel/babel-sublime) - JavaScript syntax highlighting for ES6/ES7 and JSX
  - You should set this as your default syntax when opening `.js` files by following the instructions [here](https://github.com/babel/babel-sublime#setting-as-the-default-syntax)
- [SublimeLinter](http://sublimelinter.readthedocs.io/en/latest/installation.html)
- [SublimeLinter-eslint](https://github.com/roadhump/SublimeLinter-eslint) - Linter plugin to highlight JavaScript by reading the `.eslintrc.js` file

Some additional helper plugins:

- [DocBlockr](https://github.com/spadgos/sublime-jsdocs) - Helps document functions by typing `/**` and pressing tab
- [Emmet](https://emmet.io/) - autocomplete HTML snippets, you can type `div.header{hello}` and press tab -> it will turn into `<div className="header">hello</div>`

You can install all the packages at once by pressing <kbd>cmd</kbd><kbd>shift</kbd><kbd>p</kbd> (On OSX) and typing "Advanced install package". Copy and paste the list of packages below:

```
"Babel", "DocBlockr", "Sass", "SublimeLinter", "SublimeLinter-eslint",
```

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

#### Redux Modules... _What the Duck_?

The `client/src/redux/modules` folder contains "modules" to help
isolate concerns within a Redux application (aka [Ducks](https://github.com/erikras/ducks-modular-redux).

#### Styles

TODO: complete this section.
