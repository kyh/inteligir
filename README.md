[![Dependencies Status](https://david-dm.org/tehkaiyu/inteligir/status.svg)](https://david-dm.org/tehkaiyu/inteligir)
[![Build Status](https://travis-ci.org/tehkaiyu/inteligir.svg?branch=master)](https://travis-ci.org/tehkaiyu/inteligir) [![Greenkeeper badge](https://badges.greenkeeper.io/tehkaiyu/inteligir.svg)](https://greenkeeper.io/)

# Inteligir

> The data share platform

## Directory Layout

```
├── /components                  # React components, reusable across all pages
│── /apollo                      # Client side apollo configuration
│── /pages                       # App routes
│   └── /api                     # Graphql API
│── /docs                        # App documentation
│── /prisma                      # Prisma datamodel and seed data
│── /tests                       # Test setup files
└── /worker                      # Internal worker modules
```

#### Setting up for development

1. Install dependencies

   ```
   npm i
   ```

1. Start a postgres database

   ```
   npm run db:start
   ```

1. Initialize your db schema

   ```
   npm run db:migrate
   ```

1. Source development environment variables (we use [direnv](https://direnv.net/))

   ```
   direnv
   ```

1. Start nextjs dev mode

   ```
   npm run dev
   ```

1. In another terminal start Nexus reflection to benefit from the type safety that Nexus can give you.

   ```
   npm run nexus:reflection
   ```

#### Migrations

1. When you are running Nexus' dev mode then Nexus will take care of migrating your development databse

1. To migrate the production database

   ```
   npm run db:migrate
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
