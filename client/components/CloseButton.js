import React from 'react';
import PropTypes from 'prop-types';

import IconButton from './IconButton';

const CloseButton = (props) => <IconButton {...props} name="close" />;

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
