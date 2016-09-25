import React, { Component, PropTypes } from 'react';
const styles = require('./UserProfile.scss');

export default class UserProfile extends Component {
  static propTypes = {
    user: PropTypes.object,
    logout: PropTypes.func
  };

  renderUserThumbnail(user) {
    return user.first_name[0] + user.last_name[0];
  }

  render() {
    const {user, logout} = this.props;

    return (
      <section className={styles.userProfile}>
        <div className={styles.userProfileThumbnail}>
          {this.renderUserThumbnail(user)}
        </div>
        <div className={styles.userProfileDescription}>
          <h1 className={styles.userProfileName}>{user.first_name}</h1>
          <h4 className={styles.userProfileheadline}>{user.headline}</h4>
          <p className={styles.userProfileBio}>{user.bio}</p>
        </div>
        <button onClick={logout}>Log Out</button>
      </section>
    );
  }
}
