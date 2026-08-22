import { describe, it } from "node:test";
import assert from "node:assert";
import {
  computeRawReadingsConsumption,
  consumptionKl,
  dailyConsumptionSeries,
  sumDailyConsumption,
  cumulativeMeterKl,
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

  describe("dailyConsumptionSeries / sumDailyConsumption (reset + gap aware)", () => {
    const round3 = (n: number) => Math.round(n * 1000) / 1000;

    it("sorts unsorted rows and matches the daily deltas", () => {
      const days = [
        { opening_reading: "1.0", closing_reading: "1.6", reading_date: "2026-08-02", consumption: "0.6" },
        { opening_reading: "0.0", closing_reading: "1.0", reading_date: "2026-08-01", consumption: "1.0" },
      ];
      const series = dailyConsumptionSeries(days);
      assert.deepStrictEqual(series.map((d) => d.date), ["2026-08-01", "2026-08-02"]);
      assert.strictEqual(round3(sumDailyConsumption(days)), 1.6);
    });

    it("survives a mid-window meter reset (no negative blow-up)", () => {
      const days = [
        { opening_reading: "161.294", closing_reading: "162.659", reading_date: "2026-08-10", consumption: "1.365" },
        { opening_reading: "162.659", closing_reading: "0.000", reading_date: "2026-08-11", consumption: "-162.659" },
        { opening_reading: "0.000", closing_reading: "1.102", reading_date: "2026-08-12", consumption: "1.102" },
      ];
      // 1.365 (10th) + 0 (reset day) + 1.102 (12th) = 2.467
      assert.strictEqual(round3(sumDailyConsumption(days)), 2.467);
    });

    it("recovers consumption lost in a data gap (opening jumps over prev closing)", () => {
      const days = [
        { opening_reading: "152.509", closing_reading: "152.667", reading_date: "2026-07-26", consumption: "0.158" },
        // 07-27 & 07-28 missing; opening jumps to 153.343 -> 0.676 kL happened in the gap
        { opening_reading: "153.343", closing_reading: "153.902", reading_date: "2026-07-29", consumption: "0.559" },
      ];
      // 0.158 + (gap 0.676) + 0.559 = 1.393
      assert.strictEqual(round3(sumDailyConsumption(days)), 1.393);
    });

    it("ignores 0/0 filler rows and measures the gap across them", () => {
      const days = [
        { opening_reading: "10.0", closing_reading: "10.5", reading_date: "2026-08-01", consumption: "0.5" },
        { opening_reading: "0", closing_reading: "0", reading_date: "2026-08-02", consumption: "0" },
        { opening_reading: "11.0", closing_reading: "11.2", reading_date: "2026-08-03", consumption: "0.2" },
      ];
      // 0.5 + gap(11.0-10.5=0.5) + 0.2 = 1.2
      assert.strictEqual(round3(sumDailyConsumption(days)), 1.2);
    });
  });

  describe("cumulativeMeterKl (reset-aware Total Usage)", () => {
    it("no reset -> current latest reading", () => {
      const days = [
        { opening_reading: "5.0", closing_reading: "6.0", reading_date: "2026-08-01", consumption: "1.0" },
      ];
      assert.strictEqual(cumulativeMeterKl(days, { meter_reading: "6.0" }), 6.0);
    });

    it("adds back the pre-reset peak after a device reset", () => {
      const days = [
        { opening_reading: "161.294", closing_reading: "162.659", reading_date: "2026-08-10", consumption: "1.365" },
        { opening_reading: "162.659", closing_reading: "0.000", reading_date: "2026-08-11", consumption: "-162.659" },
        { opening_reading: "0.000", closing_reading: "1.102", reading_date: "2026-08-12", consumption: "1.102" },
      ];
      // current 7.843 + pre-reset peak 162.659 = 170.502
      assert.strictEqual(Math.round(cumulativeMeterKl(days, { meter_reading: "7.843" }) * 1000) / 1000, 170.502);
    });

    it("falls back to last closing when latest is missing", () => {
      const days = [
        { opening_reading: "1.0", closing_reading: "2.5", reading_date: "2026-08-01", consumption: "1.5" },
      ];
      assert.strictEqual(cumulativeMeterKl(days, null), 2.5);
    });
  });
});
