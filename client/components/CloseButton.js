import React from 'react';
import PropTypes from 'prop-types';
import { x } from 'react-icons-kit/feather/x';

import IconButton from './IconButton';

const CloseButton = (props) => <IconButton {...props} icon={x} />;

CloseButton.defaultProps = {
  size: 24,
  title: 'close',
  onClick: () => {},
};

CloseButton.propTypes = {
  onClick: PropTypes.func,
  size: PropTypes.number,
  title: PropTypes.string,
};

CloseButton.displayName = 'CloseButton';

export default CloseButton;
