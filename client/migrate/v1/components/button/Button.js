import React, { PureComponent } from 'react';
import { Button } from 'evergreen-ui';
import './Button.css';

export default class WrappedButton extends PureComponent {
  render() {
    return (
      <Button
        {...this.props}
        className={`button ${this.props.className || ''}`}
      />
    );
  }
}
