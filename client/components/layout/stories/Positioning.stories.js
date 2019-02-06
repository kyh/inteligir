import { storiesOf } from '@storybook/react';
import React from 'react';
import styled from 'styled-components';
import Icon from 'react-icons-kit';
import { x } from 'react-icons-kit/feather/x';
import { Absolute, Relative, Card, Image, Text } from '@client/components';

const TallCard = styled(Card)`
  height: 420px;
`;

const SmallAbsolute = styled(Absolute)`
  height: 100px;
`;

const MediumAbsolute = styled(Absolute)`
  height: 200px;
`;

const LargeAbsolute = styled(Absolute)`
  height: 300px;
`;

const ExtraLargeAbsolute = styled(Absolute)`
  height: 400px;
`;

storiesOf('Positioning', module)
  .add('Over an image', () => (
    <Relative width={1 / 2}>
      <Absolute bottom={16} right={16}>
        <Text color="black">Absolute positioned over image</Text>
      </Absolute>
      <Image src="https://cdn.dribbble.com/users/452635/screenshots/5945084/133.7..png" />
    </Relative>
  ))
  .add('Positioning an icon', () => (
    <Card m={2}>
      <Relative p={4}>
        <Text mt={2} textAlign="justify">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque et
          nisl dolor. Lorem ipsum dolor sit amet, consectetur adipiscing elit.
          Donec quis nisi ac est elementum consequat a eu risus. Phasellus id
          facilisis nulla. Aliquam vel semper enim, id lobortis dolor. Morbi sed
          leo at turpis rutrum posuere. Nullam tincidunt ex vitae mi sagittis,
          vel sollicitudin lectus viverra. Curabitur sit amet fringilla velit.
        </Text>
        <Absolute top="10px" right="10px">
          <Icon icon={x} color="gray" size={24} />
        </Absolute>
      </Relative>
    </Card>
  ))
  .add('Multiple absolutely positioned boxes', () => (
    <TallCard pb={3}>
      <Relative p={3}>
        <ExtraLargeAbsolute
          pl={2}
          top={0}
          right={0}
          zIndex={1}
          width={400}
          bg="#085397"
        >
          <Text.span fontSize={1} bold>
            z-index 1
          </Text.span>
        </ExtraLargeAbsolute>
        <LargeAbsolute
          pl={2}
          top={0}
          right={0}
          zIndex={2}
          width={300}
          bg="#f2633a"
        >
          <Text.span fontSize={1} bold>
            z-index 2
          </Text.span>
        </LargeAbsolute>
        <MediumAbsolute
          pl={2}
          top={0}
          right={0}
          zIndex={3}
          width={200}
          bg="#0a84c1"
        >
          <Text.span fontSize={1} bold>
            z-index 3
          </Text.span>
        </MediumAbsolute>
        <SmallAbsolute
          pl={2}
          top={0}
          right={0}
          zIndex="4"
          width={100}
          bg="#3c910e"
        >
          <Text.span fontSize={1} bold>
            z-index 4
          </Text.span>
        </SmallAbsolute>
      </Relative>
    </TallCard>
  ));
