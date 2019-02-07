import React from 'react';
import { storiesOf } from '@storybook/react';
import { withInfo } from '@storybook/addon-info';
import { Stamp } from '@client/components';

storiesOf('Stamp', module)
  .add(
    'Default Stamp',
    withInfo({
      text:
        'Use the <Stamp /> component to subtly display attributes alongside listing cells and on product detail pages. Use it in conjunction with an <Icon /> component to give it more context. An Icon placed within a Stamp will inherit the assigned Stamp color.',
    })(() => <Stamp>default stamp</Stamp>),
  )
  .add('All Colors', () => (
    <div>
      <Stamp color="gray" mr={2}>
        default stamp
      </Stamp>
    </div>
  ));
