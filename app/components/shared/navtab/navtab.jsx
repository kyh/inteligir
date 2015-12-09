import React, { Component, PropTypes } from 'react';
import { Link } from 'react-router';
import { IntlMixin } from 'react-intl';

if (process.env.BROWSER) {
  require('components/shared/navtab/navtab.css');
}

class Navtab extends Component {

  constructor(props) {
    super(props);
    this.state = {
      selectedIndex: 0,
    };
  }

  static propTypes = {
    items: PropTypes.array.isRequired
  }

  _getIntlMessage = IntlMixin.getIntlMessage

  componentWillMount() {

  }

  _selectTab(index) {
    this.setState({
      selectedIndex: index
    });
  }

  renderItem = (item, index) => {
    return (
      <li className="nav-tabs--item"
          onClick={ this._selectTab.bind(this, index) }
          key={ index }>
        { item }
      </li>
    );
  }

  render() {
    var highlightBarStyle = {
      transform: `translateY(${ this.state.selectedIndex * 40 }px)`
    };

    return (
      <ul className="nav-tabs">
        <li className="nav-tabs--highlight" style={ highlightBarStyle }></li>
        { this.props.items.map(this.renderItem, this) }
      </ul>
    );
  }

}

export default Navtab;
