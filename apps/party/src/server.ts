import { Server, type Connection, type WSMessage } from "partyserver";

export class DispatchServer extends Server {
  onMessage(sender: Connection, message: WSMessage) {
    // Relay to all other connections in the room
    for (const conn of this.getConnections()) {
      if (conn.id !== sender.id) {
        conn.send(message);
      }
    }
  }
}
