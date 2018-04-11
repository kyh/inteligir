import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { withRouter, NavLink } from 'react-router-dom';
import Logo from 'components/icons/Logo';
import './Nav.css';

class Nav extends Component {
  static propTypes = {
    isAuthenticated: PropTypes.bool.isRequired,
    location: PropTypes.object.isRequired,
  };

  renderContent() {
    switch (this.props.isAuthenticated) {
      case null:
        return;
      case false:
        return (
          <li className="nav-item">
            <NavLink className="nav-link" to="/about">
              About
            </NavLink>
            <a className="nav-link login-button" href="/auth/google">
              Login
            </a>
          </li>
        );
      default:
        return [
          <li className="nav-item" key="3">
            <NavLink className="nav-link" to="/blogs">
              My Blogs
            </NavLink>
          </li>,
          <li className="nav-item" key="2">
            <a className="nav-link logout-button" href="/auth/logout">
              Logout
            </a>
          </li>,
        ];
    }
  }

  render() {
    return (
      <nav
        className={`nav ${this.props.location.pathname === '/' ? 'light' : ''}`}
      >
        <section className="nav-container">
          <NavLink
            to={this.props.isAuthenticated ? '/blogs' : '/'}
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
  };
}

export default connect(mapStateToProps)(withRouter(Nav));
