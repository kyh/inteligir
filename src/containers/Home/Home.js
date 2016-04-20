import React, { Component } from 'react';
import Helmet from 'react-helmet';

export default class Home extends Component {
  render() {
    const styles = require('./Home.scss');
    return (
      <section className={styles.home}>
        <Helmet title="Home"/>

      </section>
    );
  }
}
