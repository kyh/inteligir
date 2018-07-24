import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { BrowserRouter, Route, Switch } from 'react-router-dom';
import { connect } from 'react-redux';
import { loadUser } from 'redux/modules/auth.module';

import Navigation from 'components/nav/Navigation';
import LandingPage from 'routes/landing/Landing';
import AboutPage from 'routes/about/About';

import Feed from 'routes/feed/Feed';
import LessonNew from 'routes/lessons/LessonNew';
import LessonShow from 'routes/lessons/LessonShow';

class App extends Component {
  static propTypes = {
    loadUser: PropTypes.func.isRequired,
  };

  componentDidMount() {
    this.props.loadUser();
  }

  render() {
    return (
      <BrowserRouter>
        <section>
          <Navigation />
          <Switch>
            <Route exact path="/lesson/new" component={LessonNew} />
            <Route exact path="/lesson/:_id" component={LessonShow} />
            <Route exact path="/feed" component={Feed} />

            <Route exact path="/" component={LandingPage} />
            <Route exact path="/about" component={AboutPage} />
          </Switch>
        </section>
      </BrowserRouter>
    );
  }
}

export default connect(
  null,
  { loadUser },
)(App);
