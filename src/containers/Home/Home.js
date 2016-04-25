import React, { Component } from 'react';
import Helmet from 'react-helmet';

const bgImage = require('./home.png');

export default class Home extends Component {
  render() {
    const styles = require('./Home.scss');
    return (
      <section className={styles.home}>
        <Helmet title="Home"/>
        <section className={styles.homeContainer}>
          <h1 className={styles.homeTitle}>
            Learning is much better with friends
          </h1>
          <p className={styles.homeDetails}>
            Create private groups and broadcast your learnings. A place to debate, share knowledge and collaborate because everything is better with community.
          </p>
        </section>
        <img src={bgImage} style={{
          position: 'absolute',
          width: '100%',
          left: '0',
          top: '0',
          opacity: '0.1',
          pointerEvents: 'none'
        }}/>
      </section>
    );
  }
}
