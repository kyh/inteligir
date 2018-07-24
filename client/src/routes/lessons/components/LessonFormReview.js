// LessonFormReview shows users their form inputs for review
import { map } from 'lodash';
import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { createLesson } from 'redux/modules/lesson.module';
import formFields from './formFields';

class LessonFormReview extends Component {
  renderFields() {
    const { formValues } = this.props;

    return map(formFields, ({ name, label }) => {
      return (
        <div key={name}>
          <label>{label}</label>
          <div>{formValues[name]}</div>
        </div>
      );
    });
  }

  renderButtons() {
    const { onCancel } = this.props;

    return (
      <div>
        <button
          className="yellow darken-3 white-text btn-flat"
          onClick={onCancel}
        >
          Back
        </button>
        <button className="green btn-flat right white-text">Save Lesson</button>
      </div>
    );
  }

  onSubmit(event) {
    event.preventDefault();
    const { createLesson, history, formValues } = this.props;
    createLesson(formValues, history);
  }

  render() {
    return (
      <form onSubmit={this.onSubmit.bind(this)}>
        <h5>Please confirm your entries</h5>
        {this.renderFields()}
        {this.renderButtons()}
      </form>
    );
  }
}

function mapStateToProps(state) {
  return { formValues: state.form.lessonForm.values };
}

export default connect(
  mapStateToProps,
  { createLesson },
)(withRouter(LessonFormReview));
