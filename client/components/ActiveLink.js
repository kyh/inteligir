import Link from 'next/link';
import { withRouter } from 'next/router';
import React, { Children } from 'react';

const ActiveLink = withRouter(({ router, children, ...props }) => (
  <Link {...props}>
    {React.cloneElement(Children.only(children), {
      className:
        `/${router.pathname.split('/')[1]}` === props.href ? `active` : null,
    })}
  </Link>
));

export default ActiveLink;
