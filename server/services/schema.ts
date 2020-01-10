import { makeSchema } from 'nexus'
import { nexusPrismaPlugin } from 'nexus-prisma'
import path from 'path'
import * as types from '@server/types'

export const schema = makeSchema({
  types,
  plugins: [nexusPrismaPlugin()],
  outputs: {
    schema: path.join(__dirname, '../schema/generated/schema.graphql'),
    typegen: path.join(__dirname, '../schema/generated/nexus.ts'),
  },
  typegenAutoConfig: {
    contextType: 'Context.Context',
    sources: [
      {
        source: '@prisma/photon',
        alias: 'photon',
      },
      {
        source: require.resolve('./context'),
        alias: 'Context',
      },
    ],
  },
})
