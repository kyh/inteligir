import React, {Component} from 'react';
import Helmet from 'react-helmet';

const bgImage = require('./about.png');

export default class About extends Component {
  render() {
    return (
      <div className="container">
        <Helmet title="About Us"/>
        <img src={bgImage} style={{
          position: 'absolute',
          width: '100%'
        }}/>
      </div>
    );
  }
}
