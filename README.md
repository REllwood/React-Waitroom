<div align="center">

# React Waitroom

**A development panel for rehearsing every awkward state in a React interface.**

[![License: MIT](https://img.shields.io/badge/license-MIT-2f6f4e?style=flat-square)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-%3E%3D22-43853d?style=flat-square&logo=node.js&logoColor=white)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-555?style=flat-square)

</div>

Most screens are built against a fast local API that always answers. Real users get the four-second response, the empty result, the half-loaded list and the booking that fails on submit. React Waitroom lets you put a request into any of those states on purpose, repeat it exactly, and watch what your interface does.

## What it does

- Register named async boundaries, such as a search or a booking, and apply a scenario to each one
- Scenarios cover latency, timeout, offline, error, empty and partial data
- Delays are seeded, so a scenario produces the same timings every run
- Scenario fixtures are versioned and can be imported and shared
- Reset cancels pending work, even when an adapter ignores its abort signal
- An event timeline shows when each request started, changed state and resolved

## Quick start

Requires Node.js 22 or newer. No `npm install` needed.

```sh
git clone https://github.com/REllwood/React-Waitroom.git
cd React-Waitroom
npm start
```

Open http://127.0.0.1:4173, pick a boundary and a scenario, then press **Apply scenario** and **Run request**. The demo app is a small travel search and booking flow.

## Status

v0.1. The scenario engine is framework-neutral and covered by tests, and the panel runs it against the demo app. Next up are the React provider, adapters for query libraries, Storybook controls and an npm package.

## Development

```sh
npm test        # engine tests
npm run check   # tests plus syntax checks
```

## License

[MIT](LICENSE)
