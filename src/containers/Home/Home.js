import React, { Component } from 'react';
import Helmet from 'react-helmet';
import copy from './copy';

const mainBg = require('./main-bg.png');
const styles = require('./Home.scss');

export default class Home extends Component {
  render() {
    return (
      <section className={styles.home}>
        <Helmet title="Home" />
        <section className={styles.homeContainer}>
          <h1 className={styles.homeTitle}>
            {copy.title}
          </h1>
          <p className={styles.homeDetails}>
            {copy.details}
          </p>
          <figure className={styles.homeImage}>
            <section className={styles.homeImagePhone}>

            </section>
            <img src={mainBg} alt="Inteligir" />
          </figure>
        </section>
      </section>
    );
  }
}
