import React, { Component, PropTypes } from 'react';
import classNames from 'classnames';
import { Link, IndexLink } from 'react-router';

const styles = require('./Navigation.scss');

function renderLogo() {
  return (
    <svg version="1.1" x="0px" y="0px" viewBox="0 0 60 19.1" enableBackground="new 0 0 60 19.1" xmlSpace="preserve">
      <path d="M0,1.9c0.1-0.7,0.5-0.9,1.1-1C3.8,0.7,6.4,0.3,9,0.2c3.4-0.1,6.8-0.1,10.2,0c2.5,0.1,5.1,0.4,7.6,0.7
        c2.4,0.3,4.7,0.2,7.1-0.1c5-0.7,10.1-1,15.1-0.7c3.1,0.2,6.2,0.5,9.3,0.7c0.2,0,0.3,0.1,0.5,0.1c0.6,0,1.1,0.3,1.2,1
        c0,0.6,0,1.2,0,1.8c-0.2,0.2-0.4,0.3-0.5,0.5c-0.8,0.8-1.3,1.7-1.3,2.9c0,2.2-0.6,4.3-1.4,6.4c-1.3,3.2-3.6,5.1-7.1,5.4
        c-3.1,0.3-6.1,0.4-9.2-0.2c-3.2-0.6-5.4-2.4-6.7-5.4c-0.9-2.3-1.3-4.6-1.7-7c-0.3-1.7-2.3-2.4-3.6-1.3c-0.3,0.3-0.5,0.8-0.6,1.3
        c-0.5,1.9-0.8,3.9-1.3,5.8c-1.2,4.2-4,6.5-8.3,7c-3,0.3-5.9,0.3-8.9-0.2C7,18.3,5.1,17,3.9,14.8c-1.2-2.3-2-4.7-2-7.3
        C1.8,6.1,1.4,4.9,0.2,3.9C0.2,3.8,0.1,3.7,0,3.7C0,3.1,0,2.5,0,1.9z M11.2,2.2c-1.7,0.2-3.4,0.5-5,1.3C5.1,4,4.4,4.9,4.3,6.2
        c-0.2,1.9-0.1,3.9,0.5,5.7c0.8,2.7,2.5,4.4,5.3,4.9c3,0.5,5.9,0.5,8.9,0c3.2-0.5,5.3-2.5,6-5.6c0.4-1.7,0.4-3.4,0.5-5.1
        c0-0.7-0.3-1.3-0.8-1.8c-0.9-0.9-2-1.4-3.2-1.6c-2.2-0.3-5.1-0.8-6.6-0.8C14,1.8,11.2,2.2,11.2,2.2z M45.2,1.9
        C43.6,2,42,2.1,40.4,2.3c-1.6,0.2-3.1,0.5-4.5,1.5c-1,0.7-1.5,1.6-1.4,2.8c0.1,1.3,0.1,2.7,0.3,4c0.6,3.4,2.6,5.7,5.9,6.3
        c3,0.6,6.1,0.6,9.1,0.1c3-0.5,4.8-2.4,5.5-5.2c0.3-1.2,0.5-2.6,0.5-3.9c0.1-2.9-0.8-4.1-3.6-4.9C49.9,2.1,47.5,2,45.2,1.9z"/>
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
    const router = this.context.router;
    const shouldHideNav = (router.isActive('/login', true) && !user) ||
                          router.isActive('/new-post', true);
    const navClass = classNames({
      [styles.navDark]: router.isActive('/', true),
      [styles.navHidden]: shouldHideNav,
      [styles.navFull]: !!user,
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
                    Reading List
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
            {
              user &&
              <Link
                className={styles.navNewPost}
                activeClassName={styles.active}
                to="/new-post"
              >
                New Post
              </Link>
            }
          </div>
        </div>
      </header>
    );
  }
}
