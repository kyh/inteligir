import { mutationType, stringArg, idArg } from 'nexus'
import { UserInputError } from 'apollo-server-micro'
import { hash, compare } from 'bcrypt'
import { sign } from 'jsonwebtoken'
import { keys } from '@server/config/keys'

export const Mutation = mutationType({
  definition(t) {
    /**
     * Authentication
     */
    t.field('signup', {
      type: 'AuthPayload',
      args: {
        displayName: stringArg({ nullable: true }),
        email: stringArg({ nullable: false }),
        password: stringArg({ nullable: false }),
      },
      resolve: async (_parent, { email, password, displayName }, context) => {
        const hashedPassword = await hash(password, 10)
        const user = await context.prisma.users.create({
          data: {
            displayName,
            email,
            password: hashedPassword,
          },
        })
        const token = sign({ userId: user.id }, keys.auth.jwtSecret)
        context.response.cookie('token', token, {
          httpOnly: true,
          maxAge: 1000 * 60 * 60 * 24 * 365,
        })

        return { token, user }
      },
    })

    t.field('login', {
      type: 'AuthPayload',
      args: {
        email: stringArg({ nullable: false }),
        password: stringArg({ nullable: false }),
      },
      resolve: async (_parent, { email, password }, context) => {
        // 1. Check if there is a user with that email
        const user = await context.prisma.users.findOne({
          where: {
            email,
          },
        })
        if (!user) {
          throw new UserInputError(`No user found for email: ${email}`)
        }
        // 2. Check if their password is correct
        const passwordValid = await compare(password, user.password)
        if (!passwordValid) {
          throw new UserInputError('Invalid password')
        }
        // 3. Generate the JWT Token
        const token = sign({ userId: user.id }, keys.auth.jwtSecret)
        // 4. Set the cookie with the token
        context.response.cookie('token', token, {
          httpOnly: true,
          maxAge: 1000 * 60 * 60 * 24 * 365,
        })
        // 5. Return the user
        return { token, user }
      },
    })

    t.field('logout', {
      type: 'AuthPayload',
      resolve: async (_parent, _args, context) => {
        context.response.clearCookie('token')
        return { token: null, user: null }
      },
    })

    /**
     * Playlists
     */
    t.crud.createOnePlaylist()
    t.crud.deleteOnePlaylist()
    t.crud.updateOnePlaylist()
    t.field('publishPlaylist', {
      type: 'Playlist',
      nullable: true,
      args: { id: idArg({ nullable: false }) },
      resolve: (_parent, { id }, context) => {
        return context.prisma.playlists.update({
          where: { id },
          data: { published: true },
        })
      },
    })
  },
})
