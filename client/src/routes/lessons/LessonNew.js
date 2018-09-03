import React, { Component } from 'react';
import LessonEditor from './components/editor/LessonEditor';

class LessonNew extends Component {
  render() {
    return (
      <section className="padded-page">
        <LessonEditor />
      </section>
    );
  }
}

export default LessonNew;
