import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { getDiskHealth, parseSmartDisk, smartEnabled } from "../server/smart.js"
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

    assert.equal(disk.state, "critical")
    assert.equal(
      disk.metrics.find((metric) => metric.key === "temperature")?.state,
      "bad"
    )
    assert.equal(
      disk.metrics.find((metric) => metric.key === "reallocated")?.state,
      "bad"
    )
    assert.equal(
      disk.metrics.find((metric) => metric.key === "pending")?.state,
      "critical"
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

    assert.equal(disk.state, "bad")
    assert.equal(
      disk.metrics.find((metric) => metric.key === "endurance")?.value,
      "15%"
    )
    assert.equal(
      disk.metrics.find((metric) => metric.key === "available-spare")?.state,
      "bad"
    )
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
