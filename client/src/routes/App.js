import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Router, Route, Switch } from 'react-router-dom';
import { connect } from 'react-redux';
import { loadUser } from 'redux/modules/auth.module';
import History from 'util/History';

import LoadingBar from 'react-redux-loading-bar';
import Navigation from 'components/navigation/Navigation';
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
    if (!this.props.isLoaded) return null;

    return (
      <Router history={History}>
        <section>
          <LoadingBar className="loading-bar" maxProgress={100} />
          <Navigation />
          <Switch>
            <Route exact path="/lessons/new" component={LessonNew} />
            <Route exact path="/lessons/:_id" component={LessonShow} />
            <Route exact path="/feed" component={Feed} />

            <Route exact path="/" component={LandingPage} />
            <Route exact path="/about" component={AboutPage} />
          </Switch>
        </section>
      </Router>
    );
  }
}

function mapStateToProps({ auth }) {
  return { isLoaded: auth.isLoaded };
}

export default connect(
  mapStateToProps,
  { loadUser },
)(App);
