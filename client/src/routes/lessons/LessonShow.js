import 'intersection-observer';
import React, { Component } from 'react';
import { connect } from 'react-redux';
import scrollama from 'scrollama';
import { forEach } from 'lodash';

import { loadLesson } from 'redux/modules/lesson.module';
import './LessonShow.css';

class LessonShow extends Component {
  constructor(props) {
    super(props);
    this.scrollContents = {};
    this.scrollamaInstances = {};
    this.state = {
      currentStepNumber: null,
    };
  }

  componentDidMount() {
    forEach(this.scrollContents, (el, scrollContentId) => {
      const scroller = scrollama();
      const stepsContainer = el.querySelector('.steps-container');
      const steps = el.querySelectorAll('.steps-container .step');
      const chartContainer = el.querySelector('.chart-container');
      const chart = el.querySelector('.chart-container .chart');

      this.handleResize(scroller, stepsContainer, steps, chartContainer, chart);
      this.scrollamaInstances[scrollContentId] = scroller
        .setup({
          container: el,
          step: steps,
          graphic: chartContainer,
        })
        .onStepEnter(this.handleStepEnter.bind(this, scrollContentId))
        .onContainerEnter(this.handleContainerEnter)
        .onContainerExit(this.handleContainerExit);
    });

    // this.props.loadLesson(this.props.match.params._id);
  }

  handleContainerEnter = (response) => {};

  handleContainerExit = (response) => {};

  handleStepEnter = (scrollContentId, response) => {
    // response = { element, direction, index }
    console.log(scrollContentId, response);
    this.setState({
      currentActiveStep: scrollContentId + response.index,
      currentStepNumber: response.index,
    });
  };

  handleResize = (scroller, stepsContainer, steps, chartContainer, chart) => {
    // 1. update height of step elements
    const stepHeight = Math.floor(window.innerHeight * 0.75);
    forEach(steps, (step) => {
      step.setAttribute('style', `height: ${stepHeight}px`);
    });

    // 2. update width/height of chartContainer element
    const bodyWidth = document.body.offsetWidth;
    const textWidth = stepsContainer.offsetWidth;
    const chartContainerWidth = bodyWidth - textWidth;
    chartContainer.setAttribute(
      'style',
      `width: ${chartContainerWidth}px; height: ${window.innerHeight}px`,
    );

    const chartMargin = 32;
    const chartWidth = chartContainer.offsetWidth - chartMargin;
    chart.setAttribute(
      'style',
      `width: ${chartWidth}px; height: ${window.innerHeight}px`,
    );

    // 3. tell scrollama to update new element dimensions
    scroller.resize();
  };

  renderScrollContent = (scrollContentId) => {
    return (
      <div
        className="lesson-content-scroll"
        ref={(el) => (this.scrollContents[scrollContentId] = el)}
      >
        <div className="chart-container">
          <div className="chart">
            <p>{this.state.currentStepNumber}</p>
          </div>
        </div>
        <div className="steps-container">
          <div
            className={`step ${
              this.state.currentActiveStep === scrollContentId + 0
                ? 'active'
                : ''
            }`}
          >
            <p>
              Your Glacier Walk kicks off with meeting your certified glacier
              guide at the Icelandic Mountain Guides lodge next to the visitor
              center in Skaftafell.
            </p>
          </div>
          <div
            className={`step ${
              this.state.currentActiveStep === scrollContentId + 1
                ? 'active'
                : ''
            }`}
          >
            <p>
              After meeting your group, you will be provided with an ice axe,
              crampons and a harness. At the edge of the glacier, your guide
              will give you a short safety briefing. Nihil nisi iusto eum hic
              laudantium eligendi nam.
            </p>
          </div>
          <div
            className={`step ${
              this.state.currentActiveStep === scrollContentId + 2
                ? 'active'
                : ''
            }`}
          >
            <p>
              On the glacier, you will experience a stunning wonderland of ice.
              The tour ends at the original meeting point. Lorem ipsum dolor sit
              amet, consectetur adipisicing elit. Harum laboriosam asperiores
              dolor repudiandae consequatur perferendis adipisci cum ea
              provident expedita dolore blanditiis.
            </p>
          </div>
        </div>
      </div>
    );
  };

  renderDefaultContent = () => {
    return (
      <header className="intro">
        <h3>Blue Ice Experience</h3>
        <p>By: Kevin Wu, Kaiyu Hsu</p>
      </header>
    );
  };

  render() {
    return (
      <section className="lesson-page">
        <section className="lesson-content-container">
          {this.renderDefaultContent()}
          {this.renderScrollContent('asdf')}
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
