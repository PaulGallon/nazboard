import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { join } from "node:path"

import {
  FIXTURE_DIR_ENV,
  attachDatasetsToPools,
  classifyUsage,
  getStatus,
  nestDatasets,
  parseDatasets,
  parsePools,
  parseZfsSize,
  readFixture,
  type CommandResult,
} from "../server/nazboard.js"

const root = process.cwd()
const fixtureDir = join(root, "tests")

function commandResult(title: string, stdout: string): CommandResult {
  return {
    title,
    command: [],
    returncode: 0,
    stdout,
    stderr: "",
    error: null,
  }
}

describe("fixture mode", () => {
  it("loads fixed command output from fixture files", async () => {
    const result = await readFixture(
      "ZFS health summary",
      ["zpool", "status", "-x"],
      fixtureDir
    )

    assert.equal(result.returncode, 0)
    assert.match(result.stdout, /all pools are healthy/)
  })
})

describe("ZFS parsing", () => {
  it("parses ZFS sizes", () => {
    assert.equal(parseZfsSize("1K"), 1024)
    assert.equal(parseZfsSize("1.5T"), 1.5 * 1024 ** 4)
    assert.equal(parseZfsSize("-"), null)
    assert.equal(parseZfsSize("nope"), null)
  })

  it("parses pool list rows", () => {
    const pools = parsePools([
      commandResult(
        "zpool list",
        "tank\t10T\t4T\t6T\tONLINE\nbackup 8T 7T 1T DEGRADED"
      ),
    ])

    assert.equal(pools.length, 2)
    assert.equal(pools[0].name, "tank")
    assert.equal(pools[0].health, "ONLINE")
    assert.equal(pools[0].used_percent, 40)
    assert.equal(pools[1].health, "DEGRADED")
  })

  it("builds a nested dataset tree", () => {
    const datasets = parseDatasets([
      commandResult(
        "zfs list",
        [
          "NAME USED AVAIL REFER MOUNTPOINT",
          "tank 50G 50G 10G /tank",
          "tank/home 90G 10G 90G /tank/home",
          "tank/home/photos 20G 80G 20G /tank/home/photos",
          "backup 1T 3T 1T /backup",
        ].join("\n")
      ),
    ])

    const tree = nestDatasets(datasets)

    assert.deepEqual(
      tree.map((dataset) => dataset.path),
      ["backup", "tank"]
    )
    assert.equal(tree[1].children[0].path, "tank/home")
    assert.equal(tree[1].children[0].children[0].path, "tank/home/photos")
  })

  it("attaches dataset roots to their pools", () => {
    const pools = parsePools([
      commandResult("zpool list", "tank 10T 4T 6T ONLINE"),
    ])
    const datasets = parseDatasets([
      commandResult(
        "zfs list",
        "NAME USED AVAIL REFER MOUNTPOINT\ntank 4T 6T 4T /tank"
      ),
    ])

    assert.equal(
      attachDatasetsToPools(pools, datasets)[0].datasets[0].path,
      "tank"
    )
  })

  it("classifies usage thresholds", () => {
    assert.equal(classifyUsage(74.9), "ok")
    assert.equal(classifyUsage(75), "warn")
    assert.equal(classifyUsage(84.9), "warn")
    assert.equal(classifyUsage(85), "error")
  })
})

describe("status payload", () => {
  it("returns fixture-backed JSON shape", async () => {
    const previous = process.env[FIXTURE_DIR_ENV]
    process.env[FIXTURE_DIR_ENV] = fixtureDir

    try {
      const status = await getStatus()

      assert.equal(status.overall.message, "All pools are healthy")
      assert.equal(status.pools[0].name, "storage01")
      assert.equal(status.pools[0].datasets[0].path, "storage01")
      assert.equal(status.pools[0].datasets[0].children.length, 2)
      assert.equal(status.commands.length, 4)
      assert.ok(status.issues.some((issue) => issue.name === "storage01"))
    } finally {
      if (previous === undefined) {
        delete process.env[FIXTURE_DIR_ENV]
      } else {
        process.env[FIXTURE_DIR_ENV] = previous
      }
    }
  })
})
