import Link from 'next/link';
import { withRouter } from 'next/router';
import React, { Children } from 'react';

const ActiveLink = withRouter(({ router, children, href, ...props }) => (
  <Link href={href}>
    <a {...props}>
      {React.cloneElement(Children.only(children), {
        className:
          `/${router.pathname.split('/')[1]}` === props.href ? `active` : null,
      })}
    </a>
  </Link>
));

export default ActiveLink;
