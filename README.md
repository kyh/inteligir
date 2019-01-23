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
│   ├── /pages                   # App route definitions
│   ├── /static                  # Static assets
│   └── /utils                   # Client side helper functions/Utilities/Services
│   └── next.config.js           # Next.js SSR configuration
│── /config                      # Environment configuration
│── /docs                        # App documentation
│── /k8s                         # Kubernetes configuration and deployment files
│── /prisma                      # Prisma datamodel and seed data
│── /server                      # Node.js server
│   ├── /api                     # API routes, models, and controllers
│   ├── /config                  # Server environment variables
│   ├── /db                      # Prisma generated files and app schema
│   ├── /middlewares             # Express/Yoga middleware
│   ├── /resolvers               # GraphQl resolvers
│   ├── /services                # Server Helper functions/Utilities/Services
│   └── index.js                 # Server entry point
│── /tests                       # Test setup files
│── /tools                       # Setup and deployment scripts
└── /worker                      # JavaScript worker modules
```

## Want to contribute?

- [How can I help?](docs/how-to-help.md)
- [Setup your local Inteligir instance](docs/setup.md)
- [Evolving the server](docs/server.md)
- [Using the GraphQL API](docs/graphql.md)
- [Updating the client](docs/client.md)
- [List of supported environment variables](docs/environment_variables.md)
- [The design process](docs/design.md)
- [Product Features](docs/product.md)

## Discussion

If you have any questions, ping us on Slack
(https://itsbananas.slack.com).
