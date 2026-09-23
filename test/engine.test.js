import assert from "node:assert/strict";
import test from "node:test";
import {
  ScenarioEngine,
  WaitroomError,
  seededUnit,
  validateFixture
} from "../src/engine.js";

function registeredEngine(options = {}) {
  const engine = new ScenarioEngine(options);
  engine.registerBoundary({ id: "search", label: "Search" });
  return engine;
}

test("seeded jitter is stable and varies by run index", () => {
  assert.equal(seededUnit("fixture-a", "search", 0), seededUnit("fixture-a", "search", 0));
  assert.notEqual(seededUnit("fixture-a", "search", 0), seededUnit("fixture-a", "search", 1));
});

test("an exported fixture reproduces the same delay sequence", async () => {
  const firstDelays = [];
  const first = registeredEngine({
    seed: "known-seed",
    delay: async (milliseconds) => firstDelays.push(milliseconds)
  });
  first.setScenario("search", { kind: "latency", delayMs: 80, jitterMs: 100 });
  await first.run("search", async () => ["result"]);
  await first.run("search", async () => ["result"]);

  const secondDelays = [];
  const second = registeredEngine({
    delay: async (milliseconds) => secondDelays.push(milliseconds)
  });
  second.importFixture(first.exportFixture());
  await second.run("search", async () => ["result"]);
  await second.run("search", async () => ["result"]);

  assert.deepEqual(secondDelays, firstDelays);
});

test("partial and empty scenarios transform successful values", async () => {
  const engine = registeredEngine({ delay: async () => {} });
  engine.setScenario("search", { kind: "partial", delayMs: 0, keep: ["name"] });
  const partial = await engine.run("search", async () => [
    { name: "Hobart", price: 189 },
    { name: "Launceston", price: 205 }
  ]);
  assert.deepEqual(partial, [{ name: "Hobart" }, { name: "Launceston" }]);

  engine.setScenario("search", { kind: "empty", delayMs: 0, emptyValue: [] });
  assert.deepEqual(await engine.run("search", async () => ["ignored"]), []);
});

test("reset aborts pending requests and is idempotent", async () => {
  const engine = registeredEngine();
  engine.setScenario("search", { kind: "latency", delayMs: 5_000 });
  const pending = engine.run("search", async () => ["late"]);
  engine.reset();
  engine.reset();
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof WaitroomError);
    assert.equal(error.code, "CANCELLED");
    return true;
  });
  assert.equal(engine.getScenario("search").kind, "pass");
});

test("reset also cancels a host operation that is already in progress", async () => {
  const engine = registeredEngine({ delay: async () => {} });
  const pending = engine.run("search", async () => new Promise(() => {}));
  await Promise.resolve();
  engine.reset();
  await Promise.race([
    assert.rejects(pending, (error) => error.code === "CANCELLED"),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Cancellation did not settle the host operation")), 100)
    )
  ]);
});

test("starting another run settles an operation that ignores its abort signal", async () => {
  const engine = registeredEngine({ delay: async () => {} });
  const abandoned = engine.run("search", async () => new Promise(() => {}));
  await Promise.resolve();
  const replacement = engine.run("search", async () => ["replacement"]);

  await assert.rejects(abandoned, (error) => error.code === "CANCELLED");
  assert.deepEqual(await replacement, ["replacement"]);
});

test("reset settles a custom delay adapter that ignores its abort signal", async () => {
  const engine = registeredEngine({
    delay: async () => new Promise(() => {})
  });
  engine.setScenario("search", { kind: "latency", delayMs: 1 });
  const pending = engine.run("search", async () => ["late"]);
  await Promise.resolve();
  engine.reset();

  await Promise.race([
    assert.rejects(pending, (error) => error.code === "CANCELLED"),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Cancellation did not settle the custom delay")), 100)
    )
  ]);
});

test("fixture validation identifies the exact invalid field", () => {
  assert.throws(
    () =>
      validateFixture({
        version: 1,
        seed: "safe",
        scenarios: { search: { kind: "latency", delayMs: -1 } }
      }),
    (error) => {
      assert.equal(error.code, "INVALID_FIXTURE");
      assert.equal(error.details.path, "fixture.scenarios.search.delayMs");
      return true;
    }
  );
});

test("scenario validation rejects invalid HTTP status values", () => {
  for (const status of [Number.NaN, Number.POSITIVE_INFINITY, 99, 600, 503.5]) {
    assert.throws(
      () =>
        validateFixture({
          version: 1,
          seed: "safe",
          scenarios: { search: { kind: "error", delayMs: 0, status } }
        }),
      (error) => {
        assert.equal(error.code, "INVALID_FIXTURE");
        assert.equal(error.details.path, "fixture.scenarios.search.status");
        return true;
      }
    );
  }
});

test("synthetic failures do not execute the host operation", async () => {
  const engine = registeredEngine({ delay: async () => {} });
  let called = false;
  engine.setScenario("search", { kind: "error", delayMs: 0, status: 503 });
  await assert.rejects(
    engine.run("search", async () => {
      called = true;
      return [];
    }),
    (error) => error.code === "SYNTHETIC_ERROR" && error.details.status === 503
  );
  assert.equal(called, false);
});
