const FIXTURE_VERSION = 1;

export const scenarioKinds = Object.freeze([
  "pass",
  "latency",
  "timeout",
  "offline",
  "error",
  "empty",
  "partial"
]);

export class WaitroomError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "WaitroomError";
    this.code = code;
    this.details = details;
  }
}

function assertRecord(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WaitroomError(`${path} must be an object`, "INVALID_FIXTURE", { path });
  }
}

function assertInteger(value, path, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new WaitroomError(
      `${path} must be an integer of at least ${minimum}`,
      "INVALID_FIXTURE",
      { path }
    );
  }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function hashText(text) {
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededUnit(seed, boundaryId, runIndex) {
  let state = hashText(`${seed}:${boundaryId}:${runIndex}`) || 1;
  state += 0x6d2b79f5;
  let mixed = state;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
}

export function validateScenario(input, path = "scenario") {
  assertRecord(input, path);
  if (!scenarioKinds.includes(input.kind)) {
    throw new WaitroomError(
      `${path}.kind must be one of ${scenarioKinds.join(", ")}`,
      "INVALID_FIXTURE",
      { path: `${path}.kind` }
    );
  }

  const delayMs = input.delayMs ?? 0;
  const jitterMs = input.jitterMs ?? 0;
  assertInteger(delayMs, `${path}.delayMs`);
  assertInteger(jitterMs, `${path}.jitterMs`);

  if (
    input.status !== undefined &&
    (!Number.isFinite(input.status) ||
      !Number.isInteger(input.status) ||
      input.status < 100 ||
      input.status > 599)
  ) {
    throw new WaitroomError(
      `${path}.status must be an integer HTTP status from 100 to 599`,
      "INVALID_FIXTURE",
      { path: `${path}.status` }
    );
  }

  if (input.kind === "partial") {
    if (!Array.isArray(input.keep) || input.keep.some((key) => typeof key !== "string")) {
      throw new WaitroomError(
        `${path}.keep must be an array of property names`,
        "INVALID_FIXTURE",
        { path: `${path}.keep` }
      );
    }
  }

  return {
    kind: input.kind,
    delayMs,
    jitterMs,
    ...(input.message === undefined ? {} : { message: String(input.message) }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.emptyValue === undefined ? {} : { emptyValue: clone(input.emptyValue) }),
    ...(input.keep === undefined ? {} : { keep: [...input.keep] })
  };
}

function runUntilAborted(operation, signal) {
  if (signal.aborted) {
    return Promise.reject(
      new WaitroomError("Request rehearsal was cancelled", "CANCELLED")
    );
  }

  let onAbort;
  const aborted = new Promise((resolve, reject) => {
    onAbort = () => {
      reject(new WaitroomError("Request rehearsal was cancelled", "CANCELLED"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const running = Promise.resolve().then(operation);

  return Promise.race([running, aborted]).finally(() => {
    signal.removeEventListener("abort", onAbort);
  });
}

export function validateFixture(input) {
  assertRecord(input, "fixture");
  if (input.version !== FIXTURE_VERSION) {
    throw new WaitroomError(
      `fixture.version must be ${FIXTURE_VERSION}`,
      "UNSUPPORTED_FIXTURE",
      { path: "fixture.version", received: input.version }
    );
  }
  if (typeof input.seed !== "string" || input.seed.trim() === "") {
    throw new WaitroomError("fixture.seed must be a non-empty string", "INVALID_FIXTURE", {
      path: "fixture.seed"
    });
  }
  assertRecord(input.scenarios, "fixture.scenarios");

  const scenarios = {};
  for (const [boundaryId, scenario] of Object.entries(input.scenarios)) {
    if (boundaryId.trim() === "") {
      throw new WaitroomError(
        "fixture.scenarios cannot contain an empty boundary name",
        "INVALID_FIXTURE",
        { path: "fixture.scenarios" }
      );
    }
    scenarios[boundaryId] = validateScenario(
      scenario,
      `fixture.scenarios.${boundaryId}`
    );
  }
  return { version: FIXTURE_VERSION, seed: input.seed, scenarios };
}

export function defaultDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new WaitroomError("Request rehearsal was cancelled", "CANCELLED"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new WaitroomError("Request rehearsal was cancelled", "CANCELLED"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function partialValue(value, keep) {
  if (Array.isArray(value)) {
    return value.map((item) => partialValue(item, keep));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => keep.includes(key))
      .map(([key, entry]) => [key, clone(entry)])
  );
}

export class ScenarioEngine {
  #boundaries = new Map();
  #scenarios = new Map();
  #pending = new Map();
  #runCounts = new Map();
  #listeners = new Set();
  #delay;
  #seed;
  #eventSequence = 0;

  constructor({ seed = "waitroom-demo", delay = defaultDelay } = {}) {
    this.#seed = seed;
    this.#delay = delay;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(type, detail) {
    const event = {
      id: ++this.#eventSequence,
      type,
      at: Date.now(),
      ...detail
    };
    for (const listener of this.#listeners) {
      listener(event);
    }
    return event;
  }

  registerBoundary(definition) {
    assertRecord(definition, "boundary");
    if (typeof definition.id !== "string" || definition.id.trim() === "") {
      throw new WaitroomError("boundary.id must be a non-empty string", "INVALID_BOUNDARY");
    }
    if (typeof definition.label !== "string" || definition.label.trim() === "") {
      throw new WaitroomError("boundary.label must be a non-empty string", "INVALID_BOUNDARY");
    }
    this.#boundaries.set(definition.id, {
      id: definition.id,
      label: definition.label,
      description: String(definition.description ?? "")
    });
    this.#emit("boundary-registered", { boundaryId: definition.id });
    return () => {
      this.cancel(definition.id);
      this.#boundaries.delete(definition.id);
      this.#scenarios.delete(definition.id);
      this.#runCounts.delete(definition.id);
    };
  }

  listBoundaries() {
    return [...this.#boundaries.values()].map(clone);
  }

  setScenario(boundaryId, scenario) {
    this.#requireBoundary(boundaryId);
    const validated = validateScenario(scenario);
    this.#scenarios.set(boundaryId, validated);
    this.#emit("scenario-applied", {
      boundaryId,
      scenario: clone(validated)
    });
    return clone(validated);
  }

  getScenario(boundaryId) {
    this.#requireBoundary(boundaryId);
    return clone(this.#scenarios.get(boundaryId) ?? { kind: "pass", delayMs: 0, jitterMs: 0 });
  }

  #requireBoundary(boundaryId) {
    if (!this.#boundaries.has(boundaryId)) {
      throw new WaitroomError(
        `Boundary "${boundaryId}" is not registered`,
        "UNKNOWN_BOUNDARY",
        { boundaryId }
      );
    }
  }

  async run(boundaryId, operation) {
    this.#requireBoundary(boundaryId);
    if (typeof operation !== "function") {
      throw new WaitroomError("operation must be a function", "INVALID_OPERATION");
    }

    this.cancel(boundaryId);
    const controller = new AbortController();
    this.#pending.set(boundaryId, controller);
    const scenario = this.getScenario(boundaryId);
    const runIndex = this.#runCounts.get(boundaryId) ?? 0;
    this.#runCounts.set(boundaryId, runIndex + 1);
    const jitter = Math.round(seededUnit(this.#seed, boundaryId, runIndex) * scenario.jitterMs);
    const effectiveDelayMs = scenario.delayMs + jitter;
    this.#emit("request-started", {
      boundaryId,
      scenarioKind: scenario.kind,
      runIndex,
      effectiveDelayMs
    });

    try {
      if (effectiveDelayMs > 0) {
        await runUntilAborted(
          () => this.#delay(effectiveDelayMs, controller.signal),
          controller.signal
        );
      }
      if (controller.signal.aborted) {
        throw new WaitroomError("Request rehearsal was cancelled", "CANCELLED");
      }

      if (scenario.kind === "offline") {
        throw new WaitroomError(
          scenario.message ?? "Simulated offline connection",
          "OFFLINE"
        );
      }
      if (scenario.kind === "timeout") {
        throw new WaitroomError(
          scenario.message ?? "Simulated request timeout",
          "TIMEOUT"
        );
      }
      if (scenario.kind === "error") {
        throw new WaitroomError(
          scenario.message ?? "Simulated service failure",
          "SYNTHETIC_ERROR",
          { status: scenario.status ?? 500 }
        );
      }

      const value = await runUntilAborted(
        () => operation({ signal: controller.signal }),
        controller.signal
      );
      if (controller.signal.aborted) {
        throw new WaitroomError("Request rehearsal was cancelled", "CANCELLED");
      }
      let result = value;
      if (scenario.kind === "empty") {
        result = clone(scenario.emptyValue ?? []);
      } else if (scenario.kind === "partial") {
        result = partialValue(value, scenario.keep);
      }
      this.#emit("request-resolved", { boundaryId, scenarioKind: scenario.kind });
      return result;
    } catch (error) {
      const normalised =
        error instanceof WaitroomError
          ? error
          : new WaitroomError(error instanceof Error ? error.message : String(error), "OPERATION_FAILED");
      this.#emit("request-failed", {
        boundaryId,
        scenarioKind: scenario.kind,
        code: normalised.code
      });
      throw normalised;
    } finally {
      if (this.#pending.get(boundaryId) === controller) {
        this.#pending.delete(boundaryId);
      }
    }
  }

  cancel(boundaryId) {
    const pending = this.#pending.get(boundaryId);
    if (!pending) {
      return false;
    }
    pending.abort();
    this.#pending.delete(boundaryId);
    this.#emit("request-cancelled", { boundaryId });
    return true;
  }

  reset() {
    for (const boundaryId of [...this.#pending.keys()]) {
      this.cancel(boundaryId);
    }
    this.#scenarios.clear();
    this.#runCounts.clear();
    this.#emit("engine-reset", {});
  }

  exportFixture() {
    return {
      version: FIXTURE_VERSION,
      seed: this.#seed,
      scenarios: Object.fromEntries(
        [...this.#scenarios.entries()].map(([boundaryId, scenario]) => [
          boundaryId,
          clone(scenario)
        ])
      )
    };
  }

  importFixture(input) {
    const fixture = validateFixture(input);
    for (const boundaryId of Object.keys(fixture.scenarios)) {
      this.#requireBoundary(boundaryId);
    }
    this.reset();
    this.#seed = fixture.seed;
    for (const [boundaryId, scenario] of Object.entries(fixture.scenarios)) {
      this.#scenarios.set(boundaryId, scenario);
    }
    this.#emit("fixture-imported", { scenarioCount: this.#scenarios.size });
    return this.exportFixture();
  }
}
