import {
  routePartykitRequest,
  Server,
  type Connection,
  type WSMessage,
} from "partyserver";

type Env = {
  DispatchServer: DurableObjectNamespace<DispatchServer>;
};

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

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
