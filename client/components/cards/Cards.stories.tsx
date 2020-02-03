import React from 'react'
import { Card, CardContent, Header, Text } from '@components'

export default {
  title: 'Components|Data Display|Cards',
}

export const SimpleCardComponent = () => (
  <Card>
    <CardContent>
      <Header>Cards</Header>
      <Text>
        Card components can be used to display a block of information across the
        app
      </Text>
    </CardContent>
  </Card>
)

SimpleCardComponent.story = {
  name: 'Simple Card component',
}
