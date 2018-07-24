import React, { Component } from 'react';
import { connect } from 'react-redux';
import { loadLesson } from 'redux/modules/lesson.module';

class LessonShow extends Component {
  componentDidMount() {
    this.props.loadLesson(this.props.match.params._id);
  }

  render() {
    if (!this.props.lesson) {
      return '';
    }

    const { title, content } = this.props.lesson;

    return (
      <div>
        <h3>{title}</h3>
        <p>{content}</p>
      </div>
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
