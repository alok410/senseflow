import { describe, it } from "node:test";
import assert from "node:assert";
import {
  computeRawReadingsConsumption,
  consumptionKl,
  RawReading,
} from "./meter.functions.js";

describe("Water Meter Consumption Calculation", () => {
  describe("computeRawReadingsConsumption (Raw Readings Array)", () => {
    it("(a) Normal ascending readings", () => {
      const readings: RawReading[] = [
        { meter_reading: "100.0", reading_datetime: "2026-08-01T10:00:00Z" },
        { meter_reading: "150.0", reading_datetime: "2026-08-01T12:00:00Z" },
        { meter_reading: "220.0", reading_datetime: "2026-08-01T14:00:00Z" },
      ];
      const result = computeRawReadingsConsumption(readings);
      // (150 - 100) + (220 - 150) = 50 + 70 = 120
      assert.strictEqual(result, 120);
    });

    it("(b) API returning descending order (newest-first)", () => {
      const readingsDescending: RawReading[] = [
        { meter_reading: "220.0", reading_datetime: "2026-08-01T14:00:00Z" },
        { meter_reading: "150.0", reading_datetime: "2026-08-01T12:00:00Z" },
        { meter_reading: "100.0", reading_datetime: "2026-08-01T10:00:00Z" },
      ];
      const result = computeRawReadingsConsumption(readingsDescending);
      // Should sort chronologically first, yielding (150 - 100) + (220 - 150) = 120
      assert.strictEqual(result, 120);
    });

    it("(c) Mid-window meter reset / replacement", () => {
      const resetReadings: RawReading[] = [
        { meter_reading: "36.4", reading_datetime: "2026-08-01T10:00:00Z" },
        { meter_reading: "0.5", reading_datetime: "2026-08-01T12:00:00Z" },
        { meter_reading: "5.5", reading_datetime: "2026-08-01T14:00:00Z" },
      ];
      const result = computeRawReadingsConsumption(resetReadings);
      // 36.4 -> 0.5 (reset detected, consumption = 0.5)
      // 0.5 -> 5.5 (normal delta = 5.0)
      // Total = 0.5 + 5.0 = 5.5
      assert.strictEqual(result, 5.5);
    });
  });

  describe("consumptionKl (Daily Rollup HistoryDay)", () => {
    it("Normal opening/closing readings", () => {
      const day = {
        opening_reading: 10,
        closing_reading: 15,
        reading_date: "2026-08-01",
        consumption: 5,
      };
      assert.strictEqual(consumptionKl(day), 5);
    });

    it("Meter reset within day (closing < opening)", () => {
      const day = {
        opening_reading: 36.4,
        closing_reading: 0.5,
        reading_date: "2026-08-01",
        consumption: -35.9,
      };
      // Closing (0.5) < Opening (36.4) -> treated as reset, returns closing reading alone (0.5)
      assert.strictEqual(consumptionKl(day), 0.5);
    });

    it("Negative consumption fallback clamping", () => {
      const day = {
        opening_reading: 0,
        closing_reading: 0,
        reading_date: "2026-08-01",
        consumption: -4142.362,
      };
      assert.strictEqual(consumptionKl(day), 0);
    });
  });
});
