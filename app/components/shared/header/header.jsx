import React, { Component, PropTypes } from 'react';
import connect from 'connect-alt';
import { Link } from 'react-router';
import { IntlMixin } from 'react-intl';

if (process.env.BROWSER) require('./header.css');

// import imageResolver from 'utils/image-resolver';

// Load styles for the header
// and load the `react-logo.png` image
// for the `<img src='' />` element
// let reactLogo;
// if (process.env.BROWSER) {
//   reactLogo = require('images/react-logo.png');
// } else {
//   reactLogo = imageResolver('images/react-logo.png');
// }

@connect(({ requests: { inProgress }, session: { session } }) =>
  ({ inProgress, session }))
class Header extends Component {

  static propTypes = {
    // inProgress: PropTypes.bool,
    session: PropTypes.object
  }

  static contextTypes = {
    locales: PropTypes.array.isRequired,
    messages: PropTypes.object.isRequired,
    flux: PropTypes.object.isRequired
  }

  i18n = IntlMixin.getIntlMessage

  handleLocaleChange(locale) {
    const { flux } = this.context;
    flux.getActions('locale').switchLocale({ locale });
  }

  handleLogout() {
    const { flux } = this.context;
    flux.getActions('session').logout();
  }

  render() {
    const { session } = this.props;
    // const { locales: [ activeLocale ] } = this.context;

    const sessionLinks = session ? [
      <span>
        <Link to={ this.i18n('routes.account') } activeClassName='active'>
          { this.i18n('header.account') }
        </Link>
        <a href='#' onClick={ ::this.handleLogout }>
          { this.i18n('header.logout') }
        </a>
      </span>
    ] : [
      <span>
        <Link to={ this.i18n('routes.login') } activeClassName='active'>
          { this.i18n('header.login') }
        </Link>
      </span>
    ];

    return (
      <header>
        <div className='app-header--wrapper'>
          <div className='app-header--logo'>
            Logo
          </div>
          {/* Links in the navbar */}
          <nav className='app-header--navbar'>
            <Link to={ this.i18n('routes.feed') } activeClassName='active'>
              { this.i18n('header.feed') }
            </Link>
            <Link to={ this.i18n('routes.groups') } activeClassName='active'>
              { this.i18n('header.groups') }
            </Link>
            { sessionLinks }
          </nav>
        </div>
      </header>
    );
  }
}

export default Header;
