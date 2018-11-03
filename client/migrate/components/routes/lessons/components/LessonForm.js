// LessonForm shows a form for a user to add input
import { map, each } from 'lodash';
import React, { Component } from 'react';
import { reduxForm, Field } from 'redux-form';
import { Link } from 'react-router-dom';
import LessonField from './LessonField';
import formFields from './formFields';

class LessonForm extends Component {
  renderFields() {
    return map(formFields, ({ label, name }) => {
      return (
        <Field
          key={name}
          component={LessonField}
          type="text"
          label={label}
          name={name}
        />
      );
    });
  }

  render() {
    return (
      <div>
        <form onSubmit={this.props.handleSubmit(this.props.onLessonSubmit)}>
          {this.renderFields()}
          <Link to="/feed" className="red btn-flat white-text">
            Cancel
          </Link>
          <button type="submit" className="teal btn-flat right white-text">
            Next
          </button>
        </form>
      </div>
    );
  }
}

function validate(values) {
  const errors = {};

  each(formFields, ({ name }) => {
    if (!values[name]) {
      errors[name] = 'You must provide a value';
    }
  });

  return errors;
}

export default reduxForm({
  validate,
  form: 'lessonForm',
  destroyOnUnmount: false,
})(LessonForm);
