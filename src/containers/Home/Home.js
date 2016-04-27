import React, { Component } from 'react';
import Helmet from 'react-helmet';
import copy from './copy';

const mainImage = require('./main-image.png');

export default class Home extends Component {
  render() {
    const styles = require('./Home.scss');
    return (
      <section className={styles.home}>
        <Helmet title="Home"/>
        <section className={styles.homeContainer}>
          <h1 className={styles.homeTitle}>
            {copy.title}
          </h1>
          <p className={styles.homeDetails}>
            {copy.details}
          </p>
          <figure className={styles.homeImage}>
            <section className={styles.homeImageScreen}>

            </section>
            <img src={mainImage} alt="Learn with friends today!"/>
          </figure>
        </section>
      </section>
    );
  }
}
