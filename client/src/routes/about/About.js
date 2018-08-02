import React from 'react';
import './About.css';

const About = () => {
  return (
    <section className="padded-page">
      <section className="container-xsmall">
        <header className="text-center">
          <h5 className="section-subtitle">A little about us</h5>
          <h1 className="section-title">The web is a educational medium</h1>
        </header>
        <p>
          Inteligir is a platform to build interactive stories and lessons
          through scrollytelling.
        </p>
        <p>
          We started Inteligir with a simple goal: to live and learn vicariously
          through the experiences of our friends across the world. We have
          awesome friends scattered throughout the globe, all with different
          interests and pursuits. Like us, they’re learning exciting new things
          each and every day. We wanted to capture those learnings and share it
          with others.
        </p>
        <p>
          Originally just a series of really long email threads between various
          small groups of 3-5 friends, Inteligir has grown into something much
          bigger. While simple email chains initially validated the usefulness
          of the idea, it was severely limiting in terms of providing a platform
          for discussion of learnings. The latest iteration of Inteligir
          addresses many of the issues and provides a suite of new
          functionality. We hope you’re as excited to learn as we are!
        </p>
      </section>
    </section>
  );
};

export default About;
