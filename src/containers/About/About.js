import React, {Component} from 'react';
import Helmet from 'react-helmet';
import copy from './copy';

export default class About extends Component {
  render() {
    const styles = require('./About.scss');
    return (
      <section className={styles.about}>
        <Helmet title="About Us"/>
        <section className={styles.aboutContainer}>
          <h5 className={styles.aboutSubtitle}>{copy.subtitle}</h5>
          <h1 className={styles.aboutTitle}>{copy.title}</h1>
          <section
            className={styles.aboutDetails}
            dangerouslySetInnerHTML={{ __html: copy.details }}
          />
        </section>
      </section>
    );
  }
}
