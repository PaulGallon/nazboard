import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  formatPropertyValue,
  searchForSelection,
  selectionFromSearch,
} from "../src/lib/status.js"

describe("status presentation", () => {
  it("formats only properties whose values represent bytes", () => {
    assert.equal(formatPropertyValue("4096", "used"), "4.0 KiB")
    assert.equal(formatPropertyValue("1784019600", "creation"), "1784019600")
    assert.equal(formatPropertyValue("1048576", "guid"), "1048576")
  })

  it("makes NFS option lists readable without changing their contents", () => {
    assert.equal(
      formatPropertyValue("rw=@10.0.0.0/8,ro=@10.1.0.0/16", "sharenfs"),
      "rw=@10.0.0.0/8,\nro=@10.1.0.0/16"
    )
  })

  it("round-trips dashboard selections through the query string", () => {
    const selections = [
      { kind: "overview" } as const,
      { kind: "raw" } as const,
      { kind: "pool", id: "storage 01" } as const,
      { kind: "dataset", id: "storage01/backups" } as const,
    ]

    for (const selection of selections) {
      assert.deepEqual(
        selectionFromSearch(searchForSelection(selection)),
        selection
      )
    }
  })
})
