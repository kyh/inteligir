import React, { Component, PropTypes } from 'react';
import { Link } from 'react-router';
import { IntlMixin } from 'react-intl';

if (process.env.BROWSER) {
  require('components/shared/navtabs.css');
}

class Navtab extends Component {

  static propTypes = {
    items: PropTypes.array.isRequired
  }

  _getIntlMessage = IntlMixin.getIntlMessage

  componentWillMount() {

  }

  _selectItem(item, index) {
    var $highlightBar = this.refs.highlightBar;
    $highlightBar.style.top = (index * 40) + 'px';
  }

  renderItem = (item, index) => {
    return (
      <li className="nav-tabs__item" key={ index } onClick={ this._selectItem.bind(this, item, index) }>
        { item }
      </li>
    );
  }

  render() {
    return (
      <ul className="nav-tabs">
        <li className="nav-tabs__highlight" ref="highlightBar"></li>
        { this.props.items.map(this.renderItem, this) }
      </ul>
    );
  }

}

export default Navtab;
