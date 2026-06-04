import { Type, type Static } from "@sinclair/typebox";

export const DispatchStateSchema = Type.Object({
  status: Type.Union([
    Type.Literal("idle"),
    Type.Literal("awaiting_pair"),
    Type.Literal("connected"),
    Type.Literal("reconnecting"),
    Type.Literal("error"),
  ]),
  roomCode: Type.Union([Type.String(), Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
});

export type DispatchState = Static<typeof DispatchStateSchema>;

export const DISPATCH_INITIAL_STATE: DispatchState = {
  status: "idle",
  roomCode: null,
  error: null,
};
