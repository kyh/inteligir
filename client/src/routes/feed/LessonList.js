import React, { Component } from 'react';
import { map } from 'lodash';
import { connect } from 'react-redux';
import { Link } from 'react-router-dom';
import { loadAllLessons } from 'redux/modules/lesson.module';

class LessonList extends Component {
  componentDidMount() {
    this.props.loadAllLessons();
  }

  renderLessons() {
    return map(this.props.lessons, (lesson) => {
      return (
        <div className="card darken-1 horizontal" key={lesson._id}>
          <div className="card-stacked">
            <div className="card-content">
              <span className="card-title">{lesson.title}</span>
              <p>{lesson.content}</p>
            </div>
            <div className="card-action">
              <Link to={`/lessons/${lesson._id}`}>Read</Link>
            </div>
          </div>
        </div>
      );
    });
  }

  render() {
    return <div>{this.renderLessons()}</div>;
  }
}

function mapStateToProps({ lessons }) {
  return { lessons };
}

export default connect(
  mapStateToProps,
  { loadAllLessons },
)(LessonList);
