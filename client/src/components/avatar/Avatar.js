import React, { PureComponent } from 'react';
import './Avatar.css';

export default class Avatar extends PureComponent {
  render() {
    return (
      <div className="avatar-container">
        <img
          src={
            this.props.profileImageUrl ||
            `https://api.adorable.io/avatars/40/${this.props.userId}.png`
          }
          alt="Profile"
        />
      </div>
    );
  }
}
