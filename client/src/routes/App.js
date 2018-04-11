import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { BrowserRouter, Route, Switch } from 'react-router-dom';
import { connect } from 'react-redux';
import { loadUser } from 'redux/modules/auth.module';

import Nav from 'components/nav/Nav';
import Landing from 'routes/landing/Landing';
import Dashboard from 'routes/Dashboard';
import BlogNew from 'routes/blogs/BlogNew';
import BlogShow from 'routes/blogs/BlogShow';

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
          <Nav />
          <Switch>
            <Route path="/blogs/new" component={BlogNew} />
            <Route exact path="/blogs/:_id" component={BlogShow} />
            <Route path="/blogs" component={Dashboard} />
            <Route path="/" component={Landing} />
          </Switch>
        </section>
      </BrowserRouter>
    );
  }
}

export default connect(null, { loadUser })(App);
