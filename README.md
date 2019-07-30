[![Dependencies Status](https://david-dm.org/its-bananas/inteligir/status.svg)](https://david-dm.org/its-bananas/inteligir)
[![Build Status](https://travis-ci.org/its-bananas/inteligir.svg?branch=master)](https://travis-ci.org/its-bananas/inteligir) [![Greenkeeper badge](https://badges.greenkeeper.io/its-bananas/inteligir.svg)](https://greenkeeper.io/)

# Inteligir

> Share knowledge from the web through playlists

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
│── /prisma                      # Prisma datamodel and seed data
│── /server                      # Node.js server
│   ├── /config                  # Server environment variables
│   ├── /schema                  # Prisma generated files and app schema
│   ├── /middlewares             # Express/Apollo middleware
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
- [Design System](docs/design.md)
- [Product Features](docs/product.md)
