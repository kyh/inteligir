import React from 'react';
import './Landing.css';

const Landing = () => {
  return (
    <section className="landing-page">
      <header className="landing-page-hero">
        <section className="container landing-page-title-container">
          <h1 className="landing-page-title">Inteligir</h1>
          <p className="landing-page-subtitle">
            The easiest way to build interactive lesson plans. Document your
            proccess, share knowledge, and create open souce courses
          </p>
        </section>
        <section className="landing-page-video-container">
          <video autoPlay loop>
            <source
              src={`${process.env.PUBLIC_URL}/assets/underwater.mp4`}
              type="video/mp4"
            />
          </video>
        </section>
        <div
          className="landing-page-particles"
          style={{
            backgroundImage: `url('${
              process.env.PUBLIC_URL
            }/assets/particles.gif')`,
          }}
        />
      </header>
    </section>
  );
};

export default Landing;
