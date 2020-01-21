export const keys = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 5000,
  auth: {
    jwtSecret: process.env.JWT_SECRET || '',
  },
  google: {
    clientID: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  },
  aws: {
    key: process.env.AWS_ACCESS_KEY_ID || '',
    secret: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
}
