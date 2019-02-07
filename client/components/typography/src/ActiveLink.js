import React from 'react';
import { withRouter } from 'next/router';
import Link from './Link';

const ActiveLink = withRouter(({ router, children, href, ...props }) => {
  const className =
    `/${router.pathname.split('/')[1]}` === href ? `active` : null;
  return (
    <Link href={href} className={className} {...props}>
      {children}
    </Link>
  );
});

export default ActiveLink;
