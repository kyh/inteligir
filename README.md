# Inteligir

> Create open souce courses. A place to debate, share knowledge, and collaborate because
everything is better with community.

## Getting Started
Clone the repo and install Node.js modules:

```
$ git clone git@github.com:Inteligir/Inteligir.git .
$ yarn
```

## Directory Layout
```
├── /client                      # [ReactJS client](app/README.md), which contains most of our UI
│   ├── /public                  # Static files (icons/images)
│   ├── /components              # React components, reusable across all pages
│   ├── /containers              # Cardiogram app pages
│   ├── /services                # Helper functions/Utilities/Services
│   ├── /redux                   # Redux modules
│   ├── /styles                  # Scss styles for everything in app/
│   └── index.js                 # Web client entry point
│── /server                      # NodeJS server
│   ├── /config                  # Server environment variables
│   ├── /middlewares             # Express app middleware
│   ├── /models                  # Cardiogram app pages
│   ├── /routes                  # API endpoints
│   ├── /services                # Server helper functions and utilities
│   └── index.js                 # Server entry point
│── /science                     # Deep neural network training and evaluation, as well as data analyses.
└── /test                        # Javascript tests
```

## Development Setup

We recommend using nvm to manage multiple node installs:

```bash
brew install nvm
# add the following two lines to your shell config:
printf "\nexport NVM_DIR=~/.nvm" >> ~/.bash_profile
printf '\nsource $$(brew --prefix nvm)/nvm.sh' >> ~/.bash_profile
source ~/.bash_profile
# now we can use nvm!
nvm install 8.9.4
# Switch versions with "nvm use 8.9.4"
# You can default your node version with "nvm alias default 8.9.4"
```

To setup the server:
- grab a `.env` from another team member and move the file into the root directory
then run:
```bash
npm run setup
```

## Building and Running Locally
```bash
npm run build
npm start
```
You can then load: (http://localhost:5000/)[http://localhost:5000/]

#### To start a dev web server with Webpack Dev Server:
```bash
npm run dev
```
This will do two things:
1) Start the Webpack Dev Server that serves assets in the client directory (it will refresh the page on any changes)
2) Start a nodemon server for the server directory which will watch all server files

## Deployment
#### To deploy to dev server on Heroku:
```bash
git push dev <branch>:master
```

#### To push to production:
```bash
git push prod <branch>:master
```
After deploying the app to production and testing whether it works, you will want to tag your release:
```bash
git tag <tag>
git push origin <tag>
```
This add a new release tag at this git commit and push the tag up to (GitHub)[https://github.com/Inteligir/Inteligir/releases].
Tag names follow [semantic versioning](http://semver.org/) e.g.
- `v1.0.0`

## Style Guide
JavaScript - this project follows the [Airbnb Style Guide](https://github.com/airbnb/javascript). If using Sublime, you can install [SublimeLinter](http://sublimelinter.readthedocs.io/en/latest/installation.html), followed by [SublimeLinter-eslint](https://github.com/roadhump/SublimeLinter-eslint) to highlight syntax directly in your editor.

#### Redux Middleware

The middleware, [`client-middleware.js`](), serves two functions:

1. To allow the action creators access to the client API facade. Remember this is the same on both the client and the server, and cannot simply be `import`ed because it holds the cookie needed to maintain session on server-to-server requests.
2. To allow some actions to pass a "promise generator", a function that takes the API client and returns a promise. Such actions require three action types, the `REQUEST` action that initiates the data loading, and a `SUCCESS` and `FAILURE` action that will be fired depending on the result of the promise.

#### Redux Modules... *What the Duck*?

The `src/redux/modules` folder contains "modules" to help
isolate concerns within a Redux application (aka [Ducks](https://github.com/erikras/ducks-modular-redux).


#### Styles

TODO: complete this section.
