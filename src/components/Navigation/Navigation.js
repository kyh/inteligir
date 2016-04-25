import React, { Component, PropTypes } from 'react';
import classNames from 'classnames';
import { Link, IndexLink } from 'react-router';

const styles = require('./Navigation.scss');

export default class Navigation extends Component {
  static propTypes = {
    user: PropTypes.object,
    logout: PropTypes.func.isRequired
  };

  static contextTypes = {
    router: React.PropTypes.object.isRequired
  };

  handleLogout = (event) => {
    event.preventDefault();
    this.props.logout();
  };

  render() {
    const {user} = this.props;
    const navClass = classNames({
      [styles.navDark]: this.context.router.isActive('/', true),
      [styles.nav]: true
    });

    return (
      <header className={ navClass }>
        <div className={styles.navWrapper}>
          <div className={styles.navMenuWrapper}>
            <div className={styles.navLogo}>
              <IndexLink to="/">
                Learn
              </IndexLink>
            </div>
          </div>

          <div className={styles.navRight}>
            <nav className={styles.navMenu}>
              <Link
                className={styles.navMenuItem}
                to="/about"
                activeClassName={styles.active}
              >
                About
              </Link>
              {user && <a onClick={this.handleLogout}>Logout</a>}
            </nav>
            {!user && <Link className={styles.navLogin} to="/login">Login</Link>}
            {user && <a href="" className={styles.navLogin} onClick={this.handleLogout}>Logout</a>}
          </div>
        </div>
      </header>
    );
  }
}
