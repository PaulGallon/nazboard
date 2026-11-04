import assert from "node:assert/strict"
import { it } from "node:test"
import { parsePoolMaintenance } from "../server/nazboard.js"

it("reads live-style scrub and multiline removal details per pool", () => {
  const result = parsePoolMaintenance(
    `  pool: storage01
  scan: scrub repaired 0B in 09:10:14 with 0 errors on Wed Sep 23 11:58:50 2026
remove: Removal of vdev 2 copied 2.01T in 11h7m, completed on Wed Apr 22 23:13:01 2026
\t7.48M memory used for removed device mappings
config:
  pool: other
  scan: none requested`,
    "storage01"
  )
  assert.equal(
    result.last_scrub_at,
    new Date("Wed Sep 23 11:58:50 2026").toISOString()
  )
  assert.match(result.removal!, /7.48M memory/)
  assert.doesNotMatch(result.scan!, /other/)
  assert.equal(
    parsePoolMaintenance("pool: other\nscan: scrub in progress", "other")
      .last_scrub_at,
    null
  )
  assert.equal(parsePoolMaintenance("", "missing").scan, null)
})
