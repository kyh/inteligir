import 'intersection-observer';
import React, { Component } from 'react';
import { connect } from 'react-redux';

import ScrollContent from 'components/scroll-content/ScrollContent';
import { loadLesson } from 'redux/modules/lesson.module';
import './LessonShow.css';

class LessonShow extends Component {
  componentDidMount() {
    // this.props.loadLesson(this.props.match.params._id);
  }

  handleContainerEnter = (response) => {
    // response = { element, direction, index }
  };

  handleContainerExit = (response) => {
    // response = { element, direction, index }
  };

  render() {
    return (
      <section className="lesson-page">
        <section className="lesson-content-container">
          <header className="intro">
            <h3>Blue Ice Experience</h3>
            <p>By: Kevin Wu, Kaiyu Hsu</p>
          </header>
          <ScrollContent
            steps={this.props.lesson && this.props.lesson.steps}
            handleContainerEnter={this.handleContainerEnter}
            handleContainerExit={this.handleContainerExit}
          />
          <footer className="outro">Done.</footer>
        </section>
      </section>
    );
  }
}

function mapStateToProps({ lessons }, ownProps) {
  return { lesson: lessons[ownProps.match.params._id] };
}

export default connect(
  mapStateToProps,
  { loadLesson },
)(LessonShow);
