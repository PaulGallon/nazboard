import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { describe, it } from "node:test"
import { join } from "node:path"
import { promisify } from "node:util"

import {
  FIXTURE_DIR_ENV,
  attachDatasetsToPools,
  classifyUsage,
  getStatus,
  nestDatasets,
  parseDatasets,
  parsePools,
  parseSnapshots,
  parseVdevs,
  parseZfsSize,
  readFixture,
  type CommandResult,
} from "../server/nazboard.js"

const root = process.cwd()
const fixtureDir = join(root, "tests")
const execFileAsync = promisify(execFile)
const generator = join(root, "scripts", "generate-test-data.sh")
const temporaryRoot = join(root, "build")

async function fakeZfsCommands(directory: string, zfsExitCode = 0) {
  const binDirectory = join(directory, "bin")
  await mkdir(binDirectory)
  await Promise.all([
    writeFile(join(binDirectory, "zpool"), '#!/bin/sh\nprintf "%s\\n" "$*"\n'),
    writeFile(
      join(binDirectory, "zfs"),
      `#!/bin/sh\nprintf "%s\\n" "$*"\nexit ${zfsExitCode}\n`
    ),
  ])
  await Promise.all([
    chmod(join(binDirectory, "zpool"), 0o755),
    chmod(join(binDirectory, "zfs"), 0o755),
  ])
  return binDirectory
}

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

describe("test data generator", () => {
  it("captures the server's fixed ZFS commands in their fixture files", async (t) => {
    const temporaryDirectory = await mkdtemp(join(temporaryRoot, "nazboard-"))
    t.after(() => rm(temporaryDirectory, { recursive: true, force: true }))
    const binDirectory = await fakeZfsCommands(temporaryDirectory)
    const outputDirectory = join(temporaryDirectory, "fixtures")

    await execFileAsync(generator, ["--output-dir", outputDirectory], {
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
      },
    })

    const expected = new Map([
      ["zpool_status_x.txt", "status -x\n"],
      ["zpool_list.txt", "list -H -o name,size,alloc,free,health\n"],
      ["zpool_status.txt", "status\n"],
      [
        "zfs_list.txt",
        "list -H -p -o name,used,avail,refer,mountpoint,usedbysnapshots\n",
      ],
      [
        "zfs_snapshots.txt",
        "list -H -p -t snapshot -o name,used,refer,creation\n",
      ],
    ])

    for (const [filename, contents] of expected) {
      assert.equal(
        await readFile(join(outputDirectory, filename), "utf8"),
        contents
      )
    }
  })

  it("redacts serial-based leaf device names", async (t) => {
    const temporaryDirectory = await mkdtemp(join(temporaryRoot, "nazboard-"))
    t.after(() => rm(temporaryDirectory, { recursive: true, force: true }))
    const binDirectory = await fakeZfsCommands(temporaryDirectory)
    const outputDirectory = join(temporaryDirectory, "fixtures")
    const serial = "ata-Samsung_SSD_870_EVO_S6PUNX0T123456"
    const status = [
      "  pool: tank",
      "config:",
      "",
      "\tNAME                                      STATE     READ WRITE CKSUM",
      "\ttank                                      ONLINE       0     0     0",
      "\t  mirror-0                                ONLINE       0     0     0",
      `\t    ${serial}  ONLINE       0     0     0`,
      "\t    wwn-0x5000c50012345678                 ONLINE       0     0     0",
      "\tspares",
      "\t  nvme-eui.0025388b12345678                AVAIL",
      "",
      "errors: No known data errors",
      "",
    ].join("\n")
    await writeFile(
      join(binDirectory, "zpool"),
      `#!/bin/sh\ncase "$*" in\n  "status"|"status -x") printf '%s' '${status}' ;;\n  *) printf '%s\\n' "$*" ;;\nesac\n`
    )

    await execFileAsync(generator, ["--output-dir", outputDirectory], {
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
      },
    })

    const fullStatus = await readFile(
      join(outputDirectory, "zpool_status.txt"),
      "utf8"
    )
    const healthStatus = await readFile(
      join(outputDirectory, "zpool_status_x.txt"),
      "utf8"
    )
    for (const output of [fullStatus, healthStatus]) {
      assert.doesNotMatch(output, /Samsung|5000c50012345678|0025388b12345678/)
      assert.match(output, /mirror-0/)
      assert.match(output, /disk-1/)
      assert.match(output, /disk-2/)
      assert.match(output, /disk-3/)
    }
  })

  it("does not replace fixtures when a command fails", async (t) => {
    const temporaryDirectory = await mkdtemp(join(temporaryRoot, "nazboard-"))
    t.after(() => rm(temporaryDirectory, { recursive: true, force: true }))
    const binDirectory = await fakeZfsCommands(temporaryDirectory, 1)
    const outputDirectory = join(temporaryDirectory, "fixtures")
    const existingFixture = join(outputDirectory, "zpool_status_x.txt")
    await mkdir(outputDirectory)
    await writeFile(existingFixture, "existing fixture\n")

    await assert.rejects(
      execFileAsync(generator, ["--output-dir", outputDirectory], {
        env: {
          ...process.env,
          PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
        },
      })
    )

    assert.equal(await readFile(existingFixture, "utf8"), "existing fixture\n")
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
    assert.equal(tree[1].snapshot_used_bytes, 0)
  })

  it("parses snapshots and their exact creation time", () => {
    const snapshots = parseSnapshots([
      commandResult("zfs snapshots", "tank/home@daily\t1024\t4096\t1784019600"),
    ])

    assert.equal(snapshots.length, 1)
    assert.equal(snapshots[0].dataset_path, "tank/home")
    assert.equal(snapshots[0].name, "daily")
    assert.equal(snapshots[0].used_bytes, 1024)
    assert.equal(snapshots[0].created_at, "2026-07-14T09:00:00.000Z")
  })

  it("parses top-level vdevs, allocation classes, and leaf disks", () => {
    const topologies = parseVdevs([
      commandResult(
        "zpool status",
        [
          "  pool: tank",
          "config:",
          "",
          "  NAME        STATE     READ WRITE CKSUM",
          "  tank        ONLINE       0     0     0",
          "    mirror-0  ONLINE       0     0     0",
          "      sda     ONLINE       0     0     0",
          "      sdb     DEGRADED     1     0     0",
          "  special",
          "    nvme0n1   ONLINE       0     0     0",
          "",
          "errors: No known data errors",
        ].join("\n")
      ),
    ])

    assert.equal(topologies[0].vdevs.length, 2)
    assert.equal(topologies[0].vdevs[0].type, "mirror")
    assert.equal(topologies[0].vdevs[0].disks[1].state, "DEGRADED")
    assert.equal(topologies[0].vdevs[1].class_name, "special")
    assert.equal(topologies[0].vdevs[1].disks[0].name, "nvme0n1")
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
      assert.equal(status.pools[0].vdevs.length, 4)
      assert.equal(status.pools[0].vdevs[0].disks.length, 2)
      assert.equal(status.pools[0].datasets[0].snapshots.length, 1)
      assert.equal(status.pools[0].datasets[0].children[0].snapshots.length, 2)
      assert.equal(status.pools[0].snapshot_used_bytes, 16_669_841_818)
      assert.equal(status.commands.length, 5)
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
