import React, { Component } from 'react';
import LessonHeader from 'routes/lessons/components/LessonHeader';
import LessonEditor from 'routes/lessons/components/editor/LessonEditor';

class LessonNew extends Component {
  render() {
    return (
      <section className="lesson-page">
        <section className="lesson-content-container">
          <LessonHeader
            lesson={{
              authors: [{ displayName: 'Kaiyu Hsu' }],
              title: 'Title...',
            }}
            editable
          />
          <div className="lesson-content-scroll">
            <div className="steps-container">
              <LessonEditor />
            </div>
            <div className="chart-container">
              <div className="chart">1</div>
            </div>
          </div>
        </section>
      </section>
    );
  }
}

export default LessonNew;
