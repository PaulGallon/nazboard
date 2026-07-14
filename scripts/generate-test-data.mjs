#!/usr/bin/env node

import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const commands = [
  {
    filename: "zpool_status_x.txt",
    command: "zpool",
    args: ["status", "-x"],
  },
  {
    filename: "zpool_list.txt",
    command: "zpool",
    args: ["list", "-H", "-o", "name,size,alloc,free,health"],
  },
  {
    filename: "zpool_status.txt",
    command: "zpool",
    args: ["status"],
  },
  {
    filename: "zfs_list.txt",
    command: "zfs",
    args: [
      "list",
      "-H",
      "-p",
      "-o",
      "name,used,avail,refer,mountpoint,usedbysnapshots",
    ],
  },
  {
    filename: "zfs_snapshots.txt",
    command: "zfs",
    args: [
      "list",
      "-H",
      "-p",
      "-t",
      "snapshot",
      "-o",
      "name,used,refer,creation",
    ],
  },
]

function usage() {
  return `Usage: node scripts/generate-test-data.mjs [--output-dir DIRECTORY]

Capture the read-only ZFS command output used by nazboard's test fixtures.
The output directory defaults to ${resolve(repositoryRoot, "tests")}.
`
}

function outputDirectory(argv) {
  let directory = resolve(repositoryRoot, "tests")

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(usage())
      process.exit(0)
    }
    if (argument === "--output-dir" && argv[index + 1]) {
      directory = resolve(argv[index + 1])
      index += 1
      continue
    }
    throw new Error(`Unknown or incomplete argument: ${argument}\n\n${usage()}`)
  }

  return directory
}

async function capture(definition) {
  const { stdout } = await execFileAsync(definition.command, definition.args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  })

  return { ...definition, stdout }
}

async function main() {
  const directory = outputDirectory(process.argv.slice(2))

  // Capture everything first so a failed command leaves existing fixtures alone.
  const captures = await Promise.all(commands.map(capture))
  await mkdir(directory, { recursive: true })

  for (const captureResult of captures) {
    const path = resolve(directory, captureResult.filename)
    await writeFile(path, captureResult.stdout, "utf8")
    process.stdout.write(`Wrote ${path}\n`)
  }

  process.stdout.write(
    "Review the generated files for host, pool, dataset, and device names before committing them.\n"
  )
}

main().catch((error) => {
  process.stderr.write(`Failed to generate test data: ${String(error)}\n`)
  process.exitCode = 1
})
