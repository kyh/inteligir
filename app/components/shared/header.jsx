import React, { Component, PropTypes } from 'react';
import { Link } from 'react-router';
import { IntlMixin } from 'react-intl';

if (process.env.BROWSER) {
  require('components/shared/header.css');
}

// import imageResolver from 'utils/image-resolver';
// import Spinner from 'components/shared/spinner';

// Load styles for the header
// and load the `react-logo.png` image
// for the `<img src='' />` element
// let reactLogo;
// if (process.env.BROWSER) {
//   reactLogo = require('images/react-logo.png');
// } else {
//   reactLogo = imageResolver('images/react-logo.png');
// }

class Header extends Component {

  static propTypes = {
    flux: PropTypes.object.isRequired,
    locales: PropTypes.array.isRequired
  }

  _getIntlMessage = IntlMixin.getIntlMessage

  // state = {
  //   spinner: false
  // }

  componentDidMount() {
    // this.props.flux
    //   .getStore('requests')
    //   .listen(this._handleRequestStoreChange);
  }

  // _handleRequestStoreChange = ({ inProgress }) =>
  //   this.setState({ spinner: inProgress })

  //   {/* Spinner in the top right corner */}
  //   <Spinner active={ this.state.spinner } />

  //   {/* React Logo in header */}
  //   <Link to='/' className='app--logo'>
  //     <img src={ reactLogo } alt='react-logo' />
  //   </Link>

  render() {
    return (
      <header>
        <div className='app__header-wrapper'>
          <div className='app__header-logo'>
            Logo
          </div>
          {/* Links in the navbar */}
          <nav className='app__header-navbar'>
            <Link
              activeClassName='active'
              to={ this._getIntlMessage('routes.feed') }>
              { this._getIntlMessage('header.feed') }
            </Link>
            <Link
              activeClassName='active'
              to={ this._getIntlMessage('routes.groups') }>
              { this._getIntlMessage('header.groups') }
            </Link>
            <Link
              activeClassName='active'
              to={ this._getIntlMessage('routes.profile') }>
              { this._getIntlMessage('header.profile') }
            </Link>
          </nav>
        </div>
      </header>
    );
  }
}

export default Header;
