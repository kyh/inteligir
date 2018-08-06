import React, { Component } from 'react';
import { map } from 'lodash';
import Tilt from 'vanilla-tilt';
import './LessonCard.css';

export default class LessonCard extends Component {
  componentDidMount() {
    Tilt.init(this.el);
  }

  componentWillUnmount() {
    this.el.vanillaTilt.destroy();
  }

  render() {
    const { lesson } = this.props;

    return (
      <article className="lesson-card" ref={(el) => (this.el = el)}>
        <h5>{lesson.title}</h5>
        <footer>
          {map(lesson.authors, (author) => (
            <span key={author._id}>{author.displayName}</span>
          ))}
        </footer>
      </article>
    );
  }
}
