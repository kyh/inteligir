import React, { Component } from 'react';
import { reduxForm } from 'redux-form';
import LessonForm from './components/LessonForm';
import LessonFormReview from './components/LessonFormReview';

class LessonNew extends Component {
  state = { showFormReview: false };

  renderContent() {
    if (this.state.showFormReview) {
      return (
        <LessonFormReview
          onCancel={() => this.setState({ showFormReview: false })}
        />
      );
    }

    return (
      <LessonForm
        onLessonSubmit={() => this.setState({ showFormReview: true })}
      />
    );
  }

  render() {
    return <section className="padded-page">{this.renderContent()}</section>;
  }
}

export default reduxForm({
  form: 'lessonForm',
})(LessonNew);
