import 'intersection-observer';
import React, { Component } from 'react';
import { connect } from 'react-redux';
import scrollama from 'scrollama';
import { forEach } from 'lodash';

import ScrollContent from 'components/scroll-content/ScrollContent';
import { loadLesson } from 'redux/modules/lesson.module';
import './LessonShow.css';

const steps = [
  {
    id: 0,
    content:
      'Your Glacier Walk kicks off with meeting your certified glacier guide at the Icelandic Mountain Guides lodge next to the visitor center in Skaftafell',
  },
  {
    id: 1,
    content:
      'After meeting your group, you will be provided with an ice axe, crampons and a harness. At the edge of the glacier, your guide will give you a short safety briefing. Nihil nisi iusto eum hic laudantium eligendi nam.',
  },
  {
    id: 2,
    content:
      'On the glacier, you will experience a stunning wonderland of ice. The tour ends at the original meeting point. Lorem ipsum dolor sit amet, consectetur adipisicing elit. Harum laboriosam asperiores dolor repudiandae consequatur perferendis adipisci cum ea provident expedita dolore blanditiis.',
  },
];

class LessonShow extends Component {
  constructor(props) {
    super(props);
    this.scrollContents = {}; // Map of `{ <scrollContentId>: <element> }
    this.scrollerParams = {}; // Map of `{ <scrollContentId>: { scrollerParam } }
  }

  componentDidMount() {
    // forEach(this.scrollContents, (el, scrollContentId) => {
    //   const scrollerParam = {
    //     instance: scrollama(),
    //     container: el,
    //     stepsContainer: el.querySelector('.steps-container'),
    //     steps: el.querySelectorAll('.steps-container .step'),
    //     chartContainer: el.querySelector('.chart-container'),
    //     chart: el.querySelector('.chart-container .chart'),
    //   };
    //   scrollerParam.instance.resize();
    //   scrollerParam.instance
    //     .setup({
    //       container: scrollerParam.container,
    //       step: scrollerParam.steps,
    //       graphic: scrollerParam.chartContainer,
    //     })
    //     .onStepEnter(this.handleStepEnter.bind(this, scrollContentId))
    //     .onContainerEnter(this.handleContainerEnter)
    //     .onContainerExit(this.handleContainerExit);
    //   this.scrollerParams[scrollContentId] = scrollerParam;
    // });
    // window.addEventListener('resize', this.handleResize);
    // this.props.loadLesson(this.props.match.params._id);
  }

  handleContainerEnter = (response) => {
    // response = { element, direction, index }
  };

  handleContainerExit = (response) => {
    // response = { element, direction, index }
  };

  render() {
    return (
      <section className="lesson-page">
        <section className="lesson-content-container">
          <header className="intro">
            <h3>Blue Ice Experience</h3>
            <p>By: Kevin Wu, Kaiyu Hsu</p>
          </header>
          <ScrollContent steps={steps} />
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
