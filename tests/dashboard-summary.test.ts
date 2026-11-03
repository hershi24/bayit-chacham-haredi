import assert from "node:assert/strict";
import test from "node:test";
import { boardLine } from "../lib/board-summary";

test("the dashboard line counts sockets that are online and sockets that are on", () => {
  assert.equal(boardLine(2, 1), "2 מחוברים · 1 פועל");
  assert.equal(boardLine(1, 0), "1 מחובר · 0 פועלים");
  assert.equal(boardLine(0, 0), "0 מחוברים · 0 פועלים");
  assert.equal(boardLine(3, 2), "3 מחוברים · 2 פועלים");
});
