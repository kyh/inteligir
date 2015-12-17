import React, { Component, PropTypes } from 'react';
// import { Link } from 'react-router';
import { IntlMixin } from 'react-intl';
import cx from 'classnames';

if (process.env.BROWSER) require('./navtab.css');

class Navtab extends Component {

  constructor(props) {
    super(props);
    this.state = {
      selectedIndex: 0
    };
  }

  static propTypes = {
    items: PropTypes.array.isRequired
  }

  _getIntlMessage = IntlMixin.getIntlMessage

  _selectTab(index) {
    this.setState({
      selectedIndex: index
    });
  }

  renderItem = (item, index) => {
    const itemClass = cx({
      'nav-tabs--item': true,
      'active': this.state.selectedIndex === index
    });

    return (
      <li className={ itemClass }
        onClick={ this._selectTab.bind(this, index) }
        key={ index }>
        { item }
      </li>
    );
  }

  render() {
    const highlightBarStyle = {
      transform: `translateY(${ this.state.selectedIndex * 40 }px)`
    };

    return (
      <ul className='nav-tabs'>
        <li className='nav-tabs--highlight' style={ highlightBarStyle }></li>
        { this.props.items.map(this.renderItem, this) }
      </ul>
    );
  }

}

export default Navtab;
