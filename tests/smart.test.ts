import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  BLOCK_DEVICE_COMMAND,
  diskAttentionSummary,
  getDiskHealth,
  parseBlockIdentities,
  parseSmartDisk,
  smartEnabled,
} from "../server/smart.js"
import type { CommandResult } from "../shared/status.js"

function result(stdout: unknown): CommandResult {
  return {
    title: "SMART test",
    command: [],
    returncode: 0,
    stdout: JSON.stringify(stdout),
    stderr: "",
    error: null,
  }
}

describe("SMART disk health", () => {
  it("is enabled by default and accepts common false values", () => {
    assert.equal(smartEnabled({}), true)
    assert.equal(smartEnabled({ NAZBOARD_SMART_ENABLED: "true" }), true)
    assert.equal(smartEnabled({ NAZBOARD_SMART_ENABLED: "0" }), false)
    assert.equal(smartEnabled({ NAZBOARD_SMART_ENABLED: "OFF" }), false)
  })

  it("classifies ATA sector counts and temperature", () => {
    const disk = parseSmartDisk(
      { name: "/dev/sda", type: "sat", protocol: "ATA" },
      result({
        device: { protocol: "ATA" },
        model_name: "Test HDD",
        wwn: { naa: 5, oui: 0xe83a97, id: 0x10001e008 },
        smart_status: { passed: true },
        temperature: { current: 52, op_limit_max: 60 },
        ata_smart_attributes: {
          table: [
            { id: 5, when_failed: "-", raw: { value: 3 } },
            { id: 197, when_failed: "-", raw: { value: 1 } },
            { id: 198, when_failed: "-", raw: { value: 0 } },
          ],
        },
      })
    )

    assert.equal(disk.state, "warning")
    assert.equal(disk.manufacturer, "Test")
    assert.equal(disk.wwn, "0x5e83a9710001e008")
    assert.equal(
      disk.metrics.find((metric) => metric.key === "temperature")?.state,
      "warning"
    )
    assert.equal(
      disk.metrics.find((metric) => metric.key === "reallocated")?.state,
      "warning"
    )
    assert.equal(
      disk.metrics.find((metric) => metric.key === "pending")?.state,
      "warning"
    )
  })

  it("uses NVMe endurance, spare, and media health", () => {
    const disk = parseSmartDisk(
      { name: "/dev/nvme0", type: "nvme", protocol: "NVMe" },
      result({
        device: { protocol: "NVMe" },
        model_name: "Test NVMe",
        smart_status: { passed: true },
        temperature: { current: 38 },
        nvme_smart_health_information_log: {
          critical_warning: 0,
          percentage_used: 85,
          available_spare: 12,
          available_spare_threshold: 10,
          media_errors: 0,
        },
      })
    )

    assert.equal(disk.state, "warning")
    assert.equal(
      disk.metrics.find((metric) => metric.key === "endurance")?.value,
      "15%"
    )
    assert.equal(
      disk.metrics.find((metric) => metric.key === "available-spare")?.state,
      "warning"
    )
  })

  it("treats explicitly unsupported SMART and zero temperature as attention, not failure", () => {
    const disk = parseSmartDisk(
      { name: "/dev/sdh", type: "scsi", protocol: "SCSI" },
      result({
        device: { protocol: "SCSI" },
        smart_support: { available: false },
        temperature: { current: 0 },
      })
    )

    assert.equal(disk.model, "Disk sdh")
    assert.equal(disk.temperature_celsius, null)
    assert.equal(disk.state, "warning")
    assert.equal(
      disk.metrics.find((metric) => metric.key === "smart-status")?.value,
      "Unavailable"
    )
    assert.equal(
      disk.metrics.find((metric) => metric.key === "temperature")?.state,
      "warning"
    )
  })

  it("does not warn when a passing disk does not support temperature", () => {
    const disk = parseSmartDisk(
      { name: "/dev/sdh", type: "sat", protocol: "ATA" },
      result({
        device: { protocol: "ATA" },
        model_name: "OCZ-ARC100",
        smart_status: { passed: true },
      })
    )

    assert.equal(disk.state, "healthy")
    assert.equal(
      disk.metrics.find((metric) => metric.key === "temperature"),
      undefined
    )
    assert.equal(
      disk.metrics.find((metric) => metric.key === "smart-status")?.value,
      "Passed"
    )
  })

  it("reserves Failed for an explicit SMART failure", () => {
    const disk = parseSmartDisk(
      { name: "/dev/sdz", type: "sat", protocol: "ATA" },
      result({
        device: { protocol: "ATA" },
        model_name: "Failing disk",
        smart_status: { passed: false },
        temperature: { current: 35 },
      })
    )

    assert.equal(disk.state, "failed")
    assert.equal(diskAttentionSummary(disk), "SMART assessment failed")
  })

  it("prioritises a failed SMART attribute over telemetry warnings", () => {
    const disk = parseSmartDisk(
      { name: "/dev/sdz", type: "sat", protocol: "ATA" },
      result({
        device: { protocol: "ATA" },
        model_name: "Threshold failure",
        smart_status: { passed: true },
        ata_smart_attributes: {
          table: [{ id: 5, when_failed: "NOW", raw: { value: 2 } }],
        },
      })
    )

    assert.equal(disk.state, "failed")
    assert.equal(diskAttentionSummary(disk), "reallocated sectors 2")
  })

  it("sorts attention disks first and identifies them in the alert", async () => {
    const health = await getDiskHealth(async (_title, command) => {
      if (command[0] === "lsblk") {
        return result({ blockdevices: [] })
      }
      if (command.includes("--scan-open")) {
        return result({
          devices: [
            { name: "/dev/sda", type: "sat", protocol: "ATA" },
            { name: "/dev/sdh", type: "sat", protocol: "ATA" },
          ],
        })
      }
      return command.includes("/dev/sda")
        ? result({
            device: { protocol: "ATA" },
            model_name: "Healthy disk",
            smart_status: { passed: true },
            temperature: { current: 35 },
          })
        : result({
            device: { protocol: "ATA" },
            model_name: "Warning disk",
            smart_status: { passed: true },
            temperature: { current: 0 },
          })
    })

    assert.deepEqual(
      health.disks.map((disk) => disk.device),
      ["/dev/sdh", "/dev/sda"]
    )
    assert.equal(
      health.message,
      "1 disk needs attention — /dev/sdh: temperature unavailable."
    )
  })

  it("parses make, model, WWN, serial, and size from block devices", () => {
    const identities = parseBlockIdentities(
      result({
        blockdevices: [
          {
            path: "/dev/sdh",
            vendor: "OCZ",
            model: "ARC100",
            wwn: "0x5e83a9710001e008",
            serial: "REDACTED",
            type: "disk",
            size: "240057409536",
          },
          { path: "/dev/sdh1", type: "part", size: 1024 },
        ],
      })
    )

    assert.deepEqual(identities, [
      {
        path: "/dev/sdh",
        manufacturer: "OCZ",
        model: "ARC100",
        serial: "REDACTED",
        wwn: "0x5e83a9710001e008",
        capacityBytes: 240_057_409_536,
      },
    ])
  })

  it("retries scan-misidentified SCSI disks through SAT", async () => {
    const calls: string[][] = []
    const health = await getDiskHealth(async (_title, command) => {
      calls.push(command)
      if (command[0] === "lsblk") {
        assert.deepEqual(command, BLOCK_DEVICE_COMMAND)
        return result({ blockdevices: [] })
      }
      if (command.includes("--scan-open")) {
        return result({
          devices: [{ name: "/dev/sdh", type: "scsi", protocol: "SCSI" }],
        })
      }
      if (command.includes("sat")) {
        return result({
          device: { protocol: "ATA" },
          model_name: "OCZ-ARC100",
          smart_support: { available: true, enabled: true },
          smart_status: { passed: true },
          temperature: { current: 31 },
          ata_smart_attributes: { table: [] },
        })
      }
      return result({
        device: { protocol: "SCSI" },
        smart_support: { available: false },
      })
    })

    assert.deepEqual(calls[2], ["smartctl", "-a", "-j", "/dev/sdh"])
    assert.deepEqual(calls[3], [
      "smartctl",
      "-a",
      "-j",
      "-d",
      "sat",
      "/dev/sdh",
    ])
    assert.equal(health.disks[0].model, "OCZ-ARC100")
    assert.equal(health.disks[0].manufacturer, "OCZ")
    assert.equal(health.disks[0].protocol, "ATA")
    assert.equal(health.disks[0].state, "healthy")
  })

  it("does not run smartctl when disabled", async () => {
    const previous = process.env.NAZBOARD_SMART_ENABLED
    process.env.NAZBOARD_SMART_ENABLED = "false"
    let calls = 0
    try {
      const health = await getDiskHealth(async () => {
        calls += 1
        return result({})
      })
      assert.equal(health.enabled, false)
      assert.equal(calls, 0)
    } finally {
      if (previous === undefined) {
        delete process.env.NAZBOARD_SMART_ENABLED
      } else {
        process.env.NAZBOARD_SMART_ENABLED = previous
      }
    }
  })
})
