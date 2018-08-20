import React, { Component } from 'react';
import scrollama from 'scrollama';
import { map } from 'lodash';

import './ScrollContent.css';

class ScrollContent extends Component {
  state = {
    currentActiveStep: null,
  };

  componentDidMount() {
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
  }

  componentWillUnmount() {
    this.scrollerParam.instance.destroy();
    window.removeEventListener('resize', this.handleResize);
  }

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
    return (
      <div className="lesson-content-scroll" ref={(el) => (this.el = el)}>
        <div className="steps-container">
          {map(this.props.steps, (step) => (
            <div
              key={step.id}
              className={`step ${
                this.state.currentActiveStep === step.id ? 'active' : ''
              }`}
            >
              {step.content}
            </div>
          ))}
        </div>
        <div className="chart-container">
          <div className="chart">
            <p>{this.state.currentActiveStep}</p>
          </div>
        </div>
      </div>
    );
  }
}

export default ScrollContent;
