require('babel-polyfill');

const environment = {
  development: {
    isProduction: false
  },
  production: {
    isProduction: true
  }
}[process.env.NODE_ENV || 'development'];

module.exports = Object.assign({
  host: process.env.HOST || 'localhost',
  port: process.env.PORT,
  apiHost: process.env.APIHOST || 'localhost',
  apiPort: process.env.APIPORT,
  app: {
    title: 'Inteligir',
    description: 'Learning is much better with community',
    head: {
      titleTemplate: 'Inteligir | %s',
      link: [
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css?family=Droid+Serif|Lato:700,400,300' }
      ],
      meta: [
        { name: 'description', content: 'Learning is much better with community' },
        { charset: 'utf-8' },
        { property: 'og:site_name', content: 'Inteligir' },
        { property: 'og:image', content: 'https://react-redux.herokuapp.com/logo.jpg' },
        { property: 'og:locale', content: 'en_US' },
        { property: 'og:title', content: 'Inteligir' },
        { property: 'og:description', content: 'Learning is much better with community' },
        { property: 'og:card', content: 'summary' },
        { property: 'og:image:width', content: '200' },
        { property: 'og:image:height', content: '200' }
      ]
    }
  }
}, environment);
