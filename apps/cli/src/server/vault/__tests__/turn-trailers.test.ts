import { describe, expect, it } from "vitest";
import { agentCommitMessage, parseAgentCommitTrailers, undoCommitMessage } from "../turn-trailers";

describe("an agent commit's trailers", () => {
  it("read back what the message wrote, as the log prints it", () => {
    expect(parseAgentCommitTrailers(`${agentCommitMessage("thr_1", "turn_1")}\n`)).toEqual({
      kind: "turn",
      threadId: "thr_1",
      turnId: "turn_1",
    });
    expect(parseAgentCommitTrailers(`${undoCommitMessage("thr_1", "turn_1")}\n`)).toEqual({
      kind: "undo",
      threadId: "thr_1",
      undoesTurnId: "turn_1",
    });
  });

  it("are the message's last paragraph alone", () => {
    expect(parseAgentCommitTrailers("vault: update a.md")).toBeNull();
    expect(
      parseAgentCommitTrailers("agent: vault update\n\nThread: thr_1\nTurn: turn_1\n\nnotes"),
    ).toBeNull();
    expect(
      parseAgentCommitTrailers(
        "agent: vault update\n\nThread: thr_1\nTurn: turn_1\nSigned-off-by: A",
      ),
    ).toEqual({ kind: "turn", threadId: "thr_1", turnId: "turn_1" });
  });

  it("name one thread and exactly one of a turn or an undo", () => {
    expect(parseAgentCommitTrailers("agent: vault update\n\nTurn: turn_1")).toBeNull();
    expect(
      parseAgentCommitTrailers("agent: vault update\n\nThread: thr_1\nThread: thr_2\nTurn: turn_1"),
    ).toBeNull();
    expect(
      parseAgentCommitTrailers("x\n\nThread: thr_1\nTurn: turn_1\nUndoes-Turn: turn_1"),
    ).toBeNull();
    expect(parseAgentCommitTrailers("agent: vault update\n\nThread: thr_1")).toBeNull();
  });
});
