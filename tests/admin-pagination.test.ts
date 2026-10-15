import test from "node:test";
import assert from "node:assert/strict";
import { adminPage } from "../lib/admin-pagination";

test("admin history rejects malformed and unsafe offsets", () => {
  for (const value of [
    undefined,
    "bad",
    "Infinity",
    "1.5",
    "-1",
    "0",
    "9007199254740992",
  ])
    assert.equal(adminPage(value), 1);
  assert.equal(adminPage("99999999"), 1_000_000);
});

test("admin history clamps links to available pages, including empty results", () => {
  assert.equal(adminPage("99", 101), 3);
  assert.equal(adminPage("2", 100), 2);
  assert.equal(adminPage("2", 50), 1);
  assert.equal(adminPage("2", 0), 1);
});
