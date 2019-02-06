import React from 'react';
import { withRouter } from 'next/router';
import Link from './Link';

const ActiveLink = withRouter(({ router, children, href, ...props }) => (
  <Link
    href={href}
    className={
      `/${router.pathname.split('/')[1]}` === props.href ? `active` : null
    }
    {...props}
  >
    {children}
  </Link>
));

export default ActiveLink;
