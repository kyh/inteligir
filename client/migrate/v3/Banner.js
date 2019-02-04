import React from 'react';
import PropTypes from 'prop-types';
import Icon from 'react-icons-kit';

import { checkCircle } from 'react-icons-kit/feather/checkCircle';
import { alertCircle } from 'react-icons-kit/feather/alertCircle';
import { info } from 'react-icons-kit/feather/info';

import Box from './Box';
import Flex from './Flex';
import Text from './Text';
import CloseButton from './CloseButton';
import Heading from './Heading';

const bannerColors = {
  green: {
    backgroundColor: 'green',
    color: 'white',
    icon: checkCircle,
  },
  lightGreen: {
    backgroundColor: 'lightGreen',
    color: 'darkGreen',
    icon: checkCircle,
  },
  red: {
    backgroundColor: 'red',
    color: 'white',
    icon: alertCircle,
  },
  lightRed: {
    backgroundColor: 'lightRed',
    color: 'darkRed',
    icon: alertCircle,
  },
  orange: {
    backgroundColor: 'orange',
    color: 'white',
    icon: alertCircle,
  },
  blue: {
    backgroundColor: 'blue',
    color: 'white',
    icon: info,
  },
  lightBlue: {
    backgroundColor: 'lightBlue',
    color: 'darkBlue',
    icon: info,
  },
};

const Banner = (props) => {
  const bannerColor = bannerColors[props.bg] || {};
  const icon = props.iconName || bannerColor.icon;

  return (
    <Box
      {...props}
      bg={bannerColor.backgroundColor || props.bg}
      color={bannerColor.color || props.color}
    >
      <Flex justifyContent="space-between" alignItems="flex-start">
        {!!icon && !!props.showIcon && (
          <Icon icon={icon} mr={2} size={24} mt="-2px" />
        )}
        <Box w={1}>
          <Text textAlign={props.textAlign}>
            <Heading.h5>{props.header}</Heading.h5>
            <Text.span fontSize={1}>{props.text}</Text.span>
            {props.children}
          </Text>
        </Box>
        {!!props.onClose && (
          <CloseButton
            onClick={props.onClose}
            ml={2}
            size={24}
            title="close"
            mt="-2px"
          />
        )}
      </Flex>
    </Box>
  );
};

Banner.displayName = 'Banner';

Banner.propTypes = {
  header: PropTypes.string,
  iconName: PropTypes.string,
  onClose: PropTypes.func,
  showIcon: PropTypes.bool,
  text: PropTypes.node,
  textAlign: PropTypes.string,
};

Banner.defaultProps = {
  bg: 'green',
  textAlign: 'left',
  showIcon: true,
};

export default Banner;
