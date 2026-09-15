import { describe, it, expect, vi } from "vitest";
import { measurePerf } from "@/lib/server/perf";

describe("Performance Instrumentation (measurePerf)", () => {
  it("measures execution time of an async operation and returns the result", async () => {
    const fn = async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { id: 1, name: "Test Item" };
    };

    const result = await measurePerf("test.operation", fn);
    expect(result).toEqual({ id: 1, name: "Test Item" });
  });

  it("propagates errors thrown inside measured operations without swallowing them", async () => {
    const failingFn = async () => {
      throw new Error("Simulated database timeout");
    };

    await expect(measurePerf("test.failing", failingFn)).rejects.toThrow(
      "Simulated database timeout"
    );
  });

  it("extracts non-sensitive item counts when provided", async () => {
    const listFn = async () => [1, 2, 3, 4, 5];
    const result = await measurePerf("test.list", listFn, (r) => r.length);
    expect(result).toHaveLength(5);
  });
});
