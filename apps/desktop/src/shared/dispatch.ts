// ---------------------------------------------------------------------------
// Remote Access (dispatch relay) state — shared main ↔ renderer shape.
//
// Discriminated on `status` so illegal combinations (a pairing string while
// disabled, a peer indicator while disconnected) are unrepresentable:
//
//   off        — Remote Access disabled (the default). No socket, no room.
//   connecting — enabled; the relay socket is dialing/re-dialing.
//   connected  — socket open and the room is claimed; `mobilePresent` says
//                whether an authenticated mobile peer is currently in the
//                room (transcript streaming is gated on it).
//   error      — fatal in-band failure (e.g. protocol version mismatch);
//                rotate or toggle to recover.
//
// `pairing` is the single user-facing credential string
// (`XXXX-XXXX-XXXX-XXXX.token`, see @repo/dispatch/pairing) — the renderer
// shows it for the user to type/scan into the mobile app.
// ---------------------------------------------------------------------------

import { Type, type Static } from "@sinclair/typebox";

const DispatchStateSchema = Type.Union([
  Type.Object({ status: Type.Literal("off") }),
  Type.Object({
    status: Type.Literal("connecting"),
    pairing: Type.String(),
  }),
  Type.Object({
    status: Type.Literal("connected"),
    pairing: Type.String(),
    mobilePresent: Type.Boolean(),
  }),
  Type.Object({
    status: Type.Literal("error"),
    pairing: Type.Union([Type.String(), Type.Null()]),
    message: Type.String(),
  }),
]);

export type DispatchState = Static<typeof DispatchStateSchema>;

export const DISPATCH_INITIAL_STATE: DispatchState = { status: "off" };
