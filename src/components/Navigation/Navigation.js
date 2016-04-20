import React, { Component, PropTypes } from 'react';
import classNames from 'classnames';
import { Link, IndexLink } from 'react-router';

const styles = require('./Navigation.scss');

export default class Navigation extends Component {
  static propTypes = {
    user: PropTypes.object,
    logout: PropTypes.func.isRequired
  };

  constructor(props) {
    super(props);
    this.state = {
      isMenuOpen: false
    };
  }

  toggleMenuState(toggle = !this.state.isMenuOpen) {
    this.setState({
      isMenuOpen: toggle
    });
  }

  handleLogout = (event) => {
    event.preventDefault();
    this.props.logout();
  };

  render() {
    const {user} = this.props;
    const navClass = classNames({
      [styles.nav]: true,
      [styles.open]: this.state.isMenuOpen
    });

    return (
      <header className={ navClass }>
        <div className={styles.navWrapper}>
          <div className={styles.navMenuWrapper}>
            <div className={styles.navLogo}>
              <IndexLink
                onClick={ () => this.toggleMenuState(false) }
                to="/"
              >
                Write
              </IndexLink>
            </div>
            <nav className={styles.navMenu}>
              <Link
                className={styles.navMenuItem}
                to="/about"
                activeClassName={styles.active}
                onClick={ () => this.toggleMenuState(false) }
              >
                About
              </Link>
              {!user &&
                <Link
                  className={`${styles.navMenuItem} ${styles.navLoginMobile}`}
                  to="/login"
                  activeClassName={styles.active}
                  onClick={ () => this.toggleMenuState(false) }
                >
                  Login
                </Link>
              }
              {user && <a onClick={this.handleLogout}>Logout</a>}
            </nav>
          </div>

          <div className={styles.navRight}>
            <a
              className={styles.navMenuIcon}
              onClick={ () => this.toggleMenuState() }
              aria-label="Menu"
            >
              Menu
            </a>
            {!user && <Link className={styles.navLogin} to="/login">Login</Link>}
            {user && <a href="" className={styles.navLogin} onClick={this.handleLogout}>Logout</a>}
          </div>
        </div>
      </header>
    );
  }
}
