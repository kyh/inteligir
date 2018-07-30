// LessonFormReview shows users their form inputs for review
import { map } from 'lodash';
import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { createLesson } from 'redux/modules/lesson.module';
import formFields from './formFields';

class LessonFormReview extends Component {
  state = { file: null };

  renderFields = () => {
    const { formValues } = this.props;

    return map(formFields, ({ name, label }) => {
      return (
        <div key={name}>
          <label>{label}</label>
          <div>{formValues[name]}</div>
        </div>
      );
    });
  };

  renderButtons = () => {
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
  };

  onFileChange = (event) => {
    this.setState({ file: event.target.files[0] });
  };

  onSubmit = (event) => {
    event.preventDefault();
    const { createLesson, history, formValues } = this.props;
    createLesson(formValues, this.state.file, history);
  };

  render() {
    return (
      <form onSubmit={this.onSubmit}>
        <h5>Please confirm your entries</h5>
        {this.renderFields()}
        <input type="file" accept="image/*" onChange={this.onFileChange} />
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
