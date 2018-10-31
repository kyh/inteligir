import React from 'react';
import { Link } from 'react-router-dom';

export default ({ lesson }) => {
  if (!lesson) return null;

  return (
    <header className="intro">
      <span className="intro-author">
        By:{' '}
        {lesson.authors.map((a) => (
          <Link key={a._id} to={`/profile/${a._id}`}>
            {a.displayName}
          </Link>
        ))}
      </span>
      <h3 className="intro-title">{lesson.title}</h3>
    </header>
  );
};
