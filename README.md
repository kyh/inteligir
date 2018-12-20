[![Build Status](https://travis-ci.org/inteligir/inteligir-platform.svg?branch=master)](https://travis-ci.org/inteligir/inteligir-platform)
[![Dependency Status](https://david-dm.org/inteligir/inteligir-platform/status.svg)](https://david-dm.org/inteligir/inteligir-platform)
[![Greenkeeper badge](https://badges.greenkeeper.io/inteligir/inteligir-platform.svg)](https://greenkeeper.io/)

# Inteligir

> Making open source accessible for everyone

Two of the most prominent barriers to developers’ involvement in open source are (a) not knowing where to begin and (b) doubting they have the right skills[\*](https://www.digitalocean.com/currents/october-2018/). Inteligir is here to change that.

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

## Want to contribute?

- [Setup your local Inteligir instance](docs/setup.md)
- [List of supported environment variables](docs/environment_variables.md)

## Discussion

If you have any questions, ping us on Slack
(https://itsbananas.slack.com).
