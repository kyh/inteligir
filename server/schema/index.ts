import { makeSchema } from 'nexus'
import { nexusPrismaPlugin } from 'nexus-prisma'
import path from 'path'
import * as types from './types'

export const schema = makeSchema({
  types,
  plugins: [nexusPrismaPlugin()],
  outputs: {
    schema: path.join(__dirname, '/generated/schema.graphqls'),
    typegen: path.join(__dirname, '/generated/nexus.ts'),
  },
  typegenAutoConfig: {
    contextType: 'Context.Context',
    sources: [
      {
        source: '@prisma/client',
        alias: 'prisma',
      },
      {
        source: require.resolve('../services/context'),
        alias: 'Context',
      },
    ],
  },
})
