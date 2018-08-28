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
            <span className="intro-author">By: Kevin Wu, Kaiyu Hsu</span>
            <h3 className="intro-title">Blue Ice Experience</h3>
          </header>
          <ScrollContent
            steps={this.props.lesson && this.props.lesson.steps}
            handleContainerEnter={this.handleContainerEnter}
            handleContainerExit={this.handleContainerExit}
          />
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
