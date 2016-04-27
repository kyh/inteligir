import React, { Component, PropTypes } from 'react';
import classNames from 'classnames';
import { Link, IndexLink } from 'react-router';

const styles = require('./Navigation.scss');

function renderLogo() {
  return (
    <svg version="1.1" x="0px" y="0px" viewBox="0 0 127.9 40.6" enable-background="new 0 0 127.9 40.6" xmlSpace="preserve">
      <path d="M0,4.1C0.2,2.7,1.1,2.1,2.4,2C8,1.5,13.6,0.6,19.3,0.4C26.5,0.1,33.7,0.1,41,0.4c5.4,0.2,10.8,0.9,16.1,1.5
        c5.1,0.6,10.1,0.5,15.2-0.2C83,0.3,93.8-0.4,104.5,0.2c6.6,0.4,13.2,1,19.8,1.6c0.4,0,0.7,0.2,1.1,0.2c1.3,0.1,2.3,0.6,2.5,2.1
        c0,1.2,0,2.5,0,3.7c-0.4,0.4-0.8,0.7-1.2,1.1c-1.7,1.7-2.7,3.7-2.8,6.2c-0.1,4.7-1.2,9.2-3,13.6c-2.8,6.8-7.6,10.8-15.1,11.5
        c-6.5,0.6-13.1,0.9-19.5-0.3c-6.8-1.3-11.6-5.1-14.2-11.6c-1.9-4.8-2.8-9.9-3.7-15c-0.6-3.5-4.9-5.2-7.6-2.8
        c-0.7,0.6-1.1,1.7-1.3,2.7c-1,4.1-1.7,8.2-2.7,12.3c-2.5,9-8.5,13.9-17.8,14.8c-6.3,0.6-12.6,0.6-18.9-0.4
        c-5.2-0.9-9.1-3.6-11.7-8.2c-2.6-4.8-4.2-10-4.4-15.5c-0.1-3.2-1-5.8-3.5-7.8C0.3,8.2,0.2,8,0,7.8C0,6.6,0,5.3,0,4.1z M24,4.6
        C20.3,5,16.7,5.7,13.4,7.4c-2.4,1.2-3.9,3.1-4.2,5.9c-0.5,4.1-0.2,8.2,1.1,12.2c1.7,5.7,5.4,9.4,11.4,10.4c6.3,1,12.6,1,18.9,0
        c6.9-1.1,11.2-5.3,12.8-12c0.8-3.5,0.8-7.2,1.1-10.9c0.1-1.5-0.7-2.8-1.8-3.9c-1.9-1.9-4.2-3-6.8-3.4c-4.7-0.7-11-1.8-14.1-1.7
        C29.8,3.9,24,4.6,24,4.6z M96.3,4.1c-3.4,0.3-6.8,0.4-10.2,0.8C82.7,5.2,79.4,6,76.6,8c-2.1,1.4-3.3,3.3-3.1,5.9
        c0.2,2.8,0.3,5.7,0.7,8.4c1.2,7.2,5.6,12,12.5,13.4c6.4,1.3,12.9,1.2,19.4,0.2c6.4-1,10.2-5,11.8-11.1c0.7-2.7,1-5.5,1-8.3
        c0.2-6.3-1.6-8.7-7.7-10.5C106.3,4.5,101.3,4.2,96.3,4.1z"/>
    </svg>
  );
}

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
      [styles.navHidden]: this.context.router.isActive('/login', true),
      [styles.nav]: true
    });

    return (
      <header className={ navClass }>
        <div className={styles.navWrapper}>
          <div className={styles.navMenuWrapper}>
            <div className={styles.navLogo}>
              {
                !user &&
                <IndexLink to="/">
                  { renderLogo() }
                </IndexLink>
              }
              {
                user &&
                <Link to="/feed">
                  { renderLogo() }
                </Link>
              }
            </div>
          </div>

          <div className={styles.navRight}>
            <nav className={styles.navMenu}>
              {
                !user &&
                <div className={styles.navMenuItemWrapper}>
                  <Link
                    className={styles.navMenuItem}
                    activeClassName={styles.active}
                    to="/about"
                  >
                    About
                  </Link>
                </div>
              }
              {
                user &&
                <div className={styles.navMenuItemWrapper}>
                  <Link
                    className={styles.navMenuItem}
                    activeClassName={styles.active}
                    to="/feed"
                  >
                    Feed
                  </Link>
                  <Link
                    className={styles.navMenuItem}
                    activeClassName={styles.active}
                    to="/groups"
                  >
                    Groups
                  </Link>
                  <Link
                    className={styles.navMenuItem}
                    activeClassName={styles.active}
                    to="/profile"
                  >
                    Profile
                  </Link>
                </div>
              }
            </nav>
            {
              !user &&
              <Link
                className={styles.navLogin}
                activeClassName={styles.active}
                to="/login"
              >
                Login
              </Link>
            }
            {user && <a href="" className={styles.navLogin} onClick={this.handleLogout}>Logout</a>}
          </div>
        </div>
      </header>
    );
  }
}
