import React, { Component } from 'react';
import { map } from 'lodash';
import { connect } from 'react-redux';
import { Link } from 'react-router-dom';
import LessonCard from 'components/lesson-card/LessonCard';
import { loadAllLessons } from 'redux/modules/lesson.module';

import './LessonList.css';

class LessonList extends Component {
  componentDidMount() {
    this.props.loadAllLessons();
  }

  renderLessons = () => {
    return map(this.props.lessons, (lesson) => {
      return (
        <Link
          className="lesson-card-container"
          to={`/lessons/${lesson._id}`}
          key={lesson._id}
        >
          <LessonCard lesson={lesson} />
        </Link>
      );
    });
  };

  render() {
    return (
      <section className="lesson-list-container">
        {this.renderLessons()}
      </section>
    );
  }
}

function mapStateToProps({ lessons }) {
  return { lessons };
}

export default connect(
  mapStateToProps,
  { loadAllLessons },
)(LessonList);
