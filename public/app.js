import { ScenarioEngine, WaitroomError } from "/src/engine.js";

const engine = new ScenarioEngine({ seed: "melbourne-winter-17" });
const boundaryDefinitions = [
  {
    id: "search",
    label: "Flight search",
    description: "GET /flights returns travel result records."
  },
  {
    id: "booking",
    label: "Booking mutation",
    description: "POST /book confirms an optimistic booking."
  }
];

for (const boundary of boundaryDefinitions) {
  engine.registerBoundary(boundary);
}

const flights = [
  { route: "MEL → HBA", carrier: "Southern Air", time: "08:20", fare: "$189" },
  { route: "MEL → HBA", carrier: "Coastal Link", time: "11:45", fare: "$214" },
  { route: "MEL → HBA", carrier: "Southern Air", time: "16:10", fare: "$246" }
];

const elements = {
  form: document.querySelector("#scenario-form"),
  boundaryList: document.querySelector("#boundary-list"),
  kind: document.querySelector("#scenario-kind"),
  delay: document.querySelector("#delay"),
  delayOutput: document.querySelector("#delay-output"),
  jitter: document.querySelector("#jitter"),
  jitterOutput: document.querySelector("#jitter-output"),
  apply: document.querySelector("#apply-button"),
  run: document.querySelector("#run-button"),
  cancel: document.querySelector("#cancel-button"),
  reset: document.querySelector("#reset-button"),
  status: document.querySelector("#operation-status"),
  interference: document.querySelector("#interference-status"),
  resultState: document.querySelector("#result-state"),
  results: document.querySelector("#travel-results"),
  timeline: document.querySelector("#timeline-list"),
  fixture: document.querySelector("#fixture-json"),
  export: document.querySelector("#export-button"),
  import: document.querySelector("#import-button")
};

let events = [];
let activeBoundaryId = boundaryDefinitions[0].id;
let requestRunning = false;
let runningBoundaryId;

function renderBoundaries() {
  elements.boundaryList.replaceChildren(
    ...engine.listBoundaries().map((boundary, index) => {
      const label = document.createElement("label");
      label.className = "boundary-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "boundary";
      input.value = boundary.id;
      input.checked = index === 0;
      input.addEventListener("change", () => {
        activeBoundaryId = boundary.id;
        syncFormToScenario();
      });
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = boundary.label;
      const description = document.createElement("small");
      description.textContent = boundary.description;
      copy.append(title, description);
      label.append(input, copy);
      return label;
    })
  );
}

function selectedScenario() {
  const kind = elements.kind.value;
  const scenario = {
    kind,
    delayMs: Number(elements.delay.value),
    jitterMs: Number(elements.jitter.value)
  };
  if (kind === "partial") {
    scenario.keep = ["route", "time"];
  } else if (kind === "empty") {
    scenario.emptyValue = [];
  } else if (kind === "error") {
    scenario.status = 503;
    scenario.message = "Simulated booking service failure";
  }
  return scenario;
}

function setLoading(label, active = true) {
  elements.status.dataset.state = active ? "loading" : "ready";
  elements.status.textContent = active ? `Loading: ${label}` : label;
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function showLoading(label, operation) {
  setLoading(label);
  await nextPaint();
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setLoading(`Could not complete the action: ${message}`, false);
    throw error;
  }
}

function updateInterference() {
  const active = engine
    .listBoundaries()
    .map((boundary) => ({ boundary, scenario: engine.getScenario(boundary.id) }))
    .filter(({ scenario }) => scenario.kind !== "pass");
  if (active.length === 0) {
    elements.interference.textContent = "No active interference";
    elements.interference.dataset.active = "false";
    return;
  }
  elements.interference.textContent = active
    .map(({ boundary, scenario }) => `${boundary.label}: ${scenario.kind}`)
    .join(" · ");
  elements.interference.dataset.active = "true";
}

function syncFormToScenario() {
  const scenario = engine.getScenario(activeBoundaryId);
  elements.kind.value = scenario.kind;
  elements.delay.value = String(scenario.delayMs);
  elements.jitter.value = String(scenario.jitterMs);
  updateRangeLabels();
}

function updateRangeLabels() {
  elements.delayOutput.textContent = `${elements.delay.value} ms`;
  elements.jitterOutput.textContent = `${elements.jitter.value} ms`;
}

function renderTimeline() {
  if (events.length === 0) {
    elements.timeline.replaceChildren(Object.assign(document.createElement("li"), {
      textContent: "No events recorded."
    }));
    return;
  }
  elements.timeline.replaceChildren(
    ...events.slice(-12).reverse().map((event) => {
      const item = document.createElement("li");
      const time = document.createElement("time");
      time.dateTime = new Date(event.at).toISOString();
      time.textContent = new Date(event.at).toLocaleTimeString("en-AU", {
        hour12: false
      });
      const copy = document.createElement("span");
      copy.textContent = event.type.replaceAll("-", " ");
      const meta = document.createElement("small");
      meta.textContent = [
        event.boundaryId,
        event.scenarioKind,
        event.effectiveDelayMs === undefined ? undefined : `${event.effectiveDelayMs} ms`,
        event.code
      ].filter(Boolean).join(" · ");
      item.append(time, copy, meta);
      return item;
    })
  );
}

engine.subscribe((event) => {
  events.push(event);
  renderTimeline();
});

function renderSearchResults(result) {
  if (!Array.isArray(result) || result.length === 0) {
    elements.resultState.textContent = "Empty response";
    elements.results.replaceChildren(Object.assign(document.createElement("p"), {
      className: "empty-copy",
      textContent: "No flights matched this rehearsal. Try resetting or selecting another outcome."
    }));
    return;
  }
  elements.resultState.textContent = `${result.length} results`;
  elements.results.replaceChildren(
    ...result.map((flight) => {
      const article = document.createElement("article");
      const route = document.createElement("h3");
      route.textContent = flight.route ?? "Route withheld";
      const carrier = document.createElement("p");
      carrier.textContent = flight.carrier ?? "Carrier data omitted";
      const detail = document.createElement("p");
      detail.className = "flight-detail";
      detail.textContent = `${flight.time ?? "Time unavailable"} · ${flight.fare ?? "Fare unavailable"}`;
      article.append(route, carrier, detail);
      return article;
    })
  );
}

function renderBooking(result) {
  elements.resultState.textContent = "Booking confirmed";
  const message = document.createElement("p");
  message.className = "booking-confirmation";
  message.textContent = `Confirmation ${result.reference}. The optimistic booking reconciled successfully.`;
  elements.results.replaceChildren(message);
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.apply.disabled = true;
  try {
    await showLoading("Applying scenario", async () => {
      await new Promise((resolve) => setTimeout(resolve, 140));
      engine.setScenario(activeBoundaryId, selectedScenario());
      updateInterference();
      elements.fixture.value = JSON.stringify(engine.exportFixture(), null, 2);
    });
    setLoading("Scenario applied. The next request will use it.", false);
  } catch {
    // showLoading has already supplied a recoverable message.
  } finally {
    elements.apply.disabled = false;
  }
});

elements.run.addEventListener("click", async () => {
  if (requestRunning) {
    return;
  }
  requestRunning = true;
  const submittedBoundaryId = activeBoundaryId;
  runningBoundaryId = submittedBoundaryId;
  elements.run.disabled = true;
  elements.cancel.disabled = false;
  elements.resultState.textContent = "Loading";
  elements.results.replaceChildren(Object.assign(document.createElement("p"), {
    className: "loading-copy",
    textContent: `Loading: Running ${submittedBoundaryId} request`
  }));
  try {
    const result = await showLoading(`Running ${submittedBoundaryId} request`, () =>
      engine.run(submittedBoundaryId, async () =>
        submittedBoundaryId === "search"
          ? structuredClone(flights)
          : { reference: "WR-2048", status: "confirmed" }
      )
    );
    if (submittedBoundaryId === "search") {
      renderSearchResults(result);
    } else {
      renderBooking(result);
    }
    setLoading("Request completed. The host response is shown.", false);
  } catch (error) {
    const code = error instanceof WaitroomError ? error.code : "OPERATION_FAILED";
    elements.resultState.textContent = code === "CANCELLED" ? "Cancelled" : "Recoverable failure";
    elements.results.replaceChildren(Object.assign(document.createElement("p"), {
      className: "error-copy",
      textContent:
        code === "CANCELLED"
          ? "The rehearsal was cancelled without stranding the request."
          : `${error.message}. Change the scenario or reset, then run it again.`
    }));
  } finally {
    requestRunning = false;
    runningBoundaryId = undefined;
    elements.run.disabled = false;
    elements.cancel.disabled = true;
  }
});

elements.cancel.addEventListener("click", () => {
  if (runningBoundaryId) {
    engine.cancel(runningBoundaryId);
  }
});

elements.reset.addEventListener("click", async () => {
  elements.reset.disabled = true;
  try {
    await showLoading("Restoring requests", async () => {
      await new Promise((resolve) => setTimeout(resolve, 140));
      engine.reset();
      syncFormToScenario();
      updateInterference();
      elements.fixture.value = JSON.stringify(engine.exportFixture(), null, 2);
    });
    setLoading("All requests restored. Reset is safe to run again.", false);
  } catch {
    // showLoading has already supplied a recoverable message.
  } finally {
    elements.reset.disabled = false;
  }
});

elements.export.addEventListener("click", async () => {
  elements.export.disabled = true;
  try {
    await showLoading("Preparing fixture export", async () => {
      await nextPaint();
      elements.fixture.value = JSON.stringify(engine.exportFixture(), null, 2);
    });
    setLoading("Fixture prepared in the text area.", false);
  } catch {
    // showLoading has already supplied a recoverable message.
  } finally {
    elements.export.disabled = false;
  }
});

elements.import.addEventListener("click", async () => {
  elements.import.disabled = true;
  try {
    await showLoading("Validating fixture", async () => {
      await nextPaint();
      engine.importFixture(JSON.parse(elements.fixture.value));
      syncFormToScenario();
      updateInterference();
    });
    setLoading("Fixture imported. Its seeded sequence is ready.", false);
  } catch {
    // showLoading has already supplied the exact validation failure.
  } finally {
    elements.import.disabled = false;
  }
});

elements.delay.addEventListener("input", updateRangeLabels);
elements.jitter.addEventListener("input", updateRangeLabels);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && requestRunning) {
    engine.cancel(runningBoundaryId);
  }
  if (event.key.toLowerCase() === "r" && event.altKey) {
    event.preventDefault();
    elements.reset.click();
  }
});

renderBoundaries();
updateRangeLabels();
elements.fixture.value = JSON.stringify(engine.exportFixture(), null, 2);
