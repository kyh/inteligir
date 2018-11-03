import React from 'react';
import Avatar from '@client/components/Avatar';

const Home = () => (
  <div>
    Hello there
    <Avatar
      imgUrl={[
        { imgUrl: '/avatars/2' },
        { imgUrl: '/avatars/1' },
        { imgUrl: '/avatars/4' },
      ]}
    />
  </div>
);

export default Home;
