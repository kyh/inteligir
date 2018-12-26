import React, { Component } from 'react';
import scrollama from 'scrollama';
import { map } from 'lodash';

import './ScrollContent.css';

class ScrollContent extends Component {
  state = {
    currentActiveStep: null,
    initialized: false,
  };

  componentDidMount() {
    if (!this.state.initialized && this.el) {
      this.initializeScroller();
    }
  }

  componentWillUnmount() {
    if (this.state.initialized) {
      this.scrollerParam.instance.destroy();
      window.removeEventListener('resize', this.handleResize);
    }
  }

  componentDidUpdate() {
    if (
      !this.state.initialized &&
      this.props.steps &&
      this.props.steps.length
    ) {
      this.initializeScroller();
    }
  }

  initializeScroller = () => {
    this.scrollerParam = {
      instance: scrollama(),
      container: this.el,
      stepsContainer: this.el.querySelector('.steps-container'),
      steps: this.el.querySelectorAll('.steps-container .step'),
      chartContainer: this.el.querySelector('.chart-container'),
      chart: this.el.querySelector('.chart-container .chart'),
    };

    this.scrollerParam.instance.resize();
    this.scrollerParam.instance
      .setup({
        container: this.scrollerParam.container,
        step: this.scrollerParam.steps,
        graphic: this.scrollerParam.chartContainer,
      })
      .onStepEnter(this.handleStepEnter)
      .onContainerEnter(this.props.handleContainerEnter)
      .onContainerExit(this.props.handleContainerExit);

    window.addEventListener('resize', this.handleResize);

    this.setState({ initialized: true });
  };

  handleResize = () => {
    this.scrollerParam.instance.resize();
  };

  handleStepEnter = (response) => {
    // response = { element, direction, index }
    this.setState({
      currentActiveStep: response.index,
    });
  };

  render() {
    const { steps } = this.props;
    const { currentActiveStep } = this.state;

    if (!steps || !steps.length) return null;

    return (
      <div className="lesson-content-scroll" ref={(el) => (this.el = el)}>
        <div className="steps-container">
          {map(steps, (step) => (
            <div
              key={step.id}
              className={`step ${
                currentActiveStep === step.id ? 'active' : ''
              }`}
            >
              {step.content}
            </div>
          ))}
        </div>
        <div className="chart-container">
          <div className="chart">
            <p>{currentActiveStep}</p>
          </div>
        </div>
      </div>
    );
  }
}

export default ScrollContent;
