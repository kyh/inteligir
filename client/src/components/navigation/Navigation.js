import React, { Component } from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import { connect } from 'react-redux';
import { withRouter, NavLink } from 'react-router-dom';
import { Dialog, Popover, Position } from 'evergreen-ui';
import Avatar from 'components/avatar/Avatar';
import Button from 'components/button/Button';
import Logo from 'components/icons/Logo';
import './Navigation.css';

class Navigation extends Component {
  static propTypes = {
    isAuthenticated: PropTypes.bool.isRequired,
    location: PropTypes.object.isRequired,
  };

  state = {
    isDialogOpen: false,
  };

  toggleDialog = () => {
    this.setState((prevState) => {
      return {
        isDialogOpen: !prevState.isDialogOpen,
      };
    });
  };

  renderContent() {
    switch (this.props.isAuthenticated) {
      case null:
        return;
      case false:
        return [
          <li className="nav-item">
            <NavLink className="nav-link" to="/about">
              About
            </NavLink>
          </li>,
          <li className="nav-item">
            <Button
              className="button-outline login-button"
              onClick={this.toggleDialog}
              marginRight={10}
            >
              Get Started
            </Button>
            <Dialog
              isShown={this.state.isDialogOpen}
              hasHeader={false}
              hasFooter={false}
              onCloseComplete={this.toggleDialog}
            >
              {({ close }) => (
                <section className="login-dialog-content">
                  <h3>Welcome back.</h3>
                  <p>
                    Sign in to access your personalized homepage, support your
                    favorite authors, and create your own lessons.
                  </p>
                  <a href="/auth/google" className="login-links">
                    <Button>Sign in with Google</Button>
                  </a>
                  <a href="/auth/facebook" className="login-links">
                    <Button>Sign in with Facebook</Button>
                  </a>
                </section>
              )}
            </Dialog>
          </li>,
        ];
      default:
        return [
          <li className="nav-item profile-button" key="1">
            <Popover
              position={Position.BOTTOM_RIGHT}
              content={({ close }) => (
                <ul role="menu" className="profile-dropdown">
                  <li className="profile-dropdown-item">
                    <NavLink onClick={close} to="/lessons/new">
                      New lesson
                    </NavLink>
                  </li>
                  <li className="profile-dropdown-item">
                    <NavLink onClick={close} to="/lessons/drafts">
                      My lessons
                    </NavLink>
                  </li>
                  <li className="profile-dropdown-item">
                    <NavLink
                      onClick={close}
                      to={`/profile/${this.props.userId}`}
                    >
                      Profile
                    </NavLink>
                  </li>
                  <li className="profile-dropdown-item">
                    <a href="/auth/logout">Sign out</a>
                  </li>
                </ul>
              )}
            >
              <Button appearance="minimal">
                <Avatar
                  profileImageUrl={this.props.profileImageUrl}
                  userId={this.props.userId}
                />
              </Button>
            </Popover>
          </li>,
        ];
    }
  }

  render() {
    const navClass = classnames({
      nav: true,
      light: this.props.location.pathname === '/',
      hidden: this.props.location.pathname.includes('/lessons/'),
    });

    return (
      <nav className={navClass}>
        <section className="nav-container">
          <NavLink
            to={this.props.isAuthenticated ? '/feed' : '/'}
            className="nav-logo"
          >
            <Logo />
          </NavLink>
          <ul className="nav-item-container">{this.renderContent()}</ul>
        </section>
      </nav>
    );
  }
}

function mapStateToProps({ auth }) {
  return {
    isAuthenticated: auth.isAuthenticated,
    displayName: auth.user && auth.user.displayName,
    userId: auth.user && auth.user._id,
    profileImageUrl: auth.user && auth.user.profileImageUrl,
  };
}

export default withRouter(connect(mapStateToProps)(Navigation));
