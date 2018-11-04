import React from 'react';
import Button from '@client/components/Button';

class Home extends React.Component {
  state = {
    isLoading: false,
  };

  render() {
    return (
      <div>
        Hello there
        <Button
          onClick={() => this.setState({ isLoading: !this.state.isLoading })}
          isLoading={this.state.isLoading}
          kind="minimal"
        >
          Click
        </Button>
      </div>
    );
  }
}

export default Home;
