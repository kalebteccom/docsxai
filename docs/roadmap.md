# Roadmap

Ranked by how much each item moves the one claim the product makes: screenshot docs that rebuild from a written flow, byte for byte, with no agent in the run. Written 2026-11-16 after a review of competing products. Each item fits one pull request or a short series.

## Where docsxai sits

Five groups of competitors. None of the pages reviewed claim byte-identical replay in CI.

- Click-recorder guide tools (Scribe, Tango, Guidde). A person records each guide. Nothing keeps the screenshots current.
- Interactive demo tools (Supademo, Arcade). Built for sales demos, hosted, priced per seat.
- Hosted screenshot refresh (Ferndesk, LaunchBrightly). Closest in intent. Hosted, no determinism claim, no flow source in your repo.
- Scriptable open source (shot-scraper, Doc Detective, Playwright scripts). Closest in method. No captions, no matrix of variants, no publishers.
- Docs platforms (Mintlify, GitBook). They flag stale text. They do not regenerate screenshots from a flow.

The edge: a written flow in your repo, a run that produces the same bytes every time, a CI gate that fails on drift, and an agent only at authoring time. The roadmap protects and widens that edge.

## Ranked

### 1. Drift gate as one CI step

`docs/ci-recipes.md` holds copy-paste workflows for GitHub Actions, GitLab CI and Woodpecker. There is no reusable action.

Ship a GitHub Action that installs a pinned version, runs `run`, `diff --fail-on warn` and `pack --check`, and posts one pull request comment with the changed screenshots. It is the shortest path from "interesting" to "in my pipeline", and the click-recorder tools cannot copy it.

Done when a pull request that moves a button gets a comment with before and after images and a red check, from a three-line workflow.

### 2. Put the publishers on npm

The Confluence, GitBook, Guru and Notion publishers are repo-only (`private: true`). SharePoint is the only one on npm, and it is experimental. Adopters who want Notion or Confluence have to wire a checkout by path.

Promote Notion and Confluence first (largest audiences), each as `experimental` on the `next` tag, then GitBook and Guru. The first release of each package needs an owner decision.

Done when `npm i -D @docsxai/plugin-notion` works and a CI recipe pushes a pack in under ten lines.

### 3. Determinism report

`run --verify-determinism` names the first artifact that differs. Extend it to name the cause (animation, font load, network timing, clock, random value) with the fix, and add a doctor check that runs a flow twice and prints a verdict. Determinism is the claim, so a failed run has to say what to do next.

Done when each known cause has a message, a docs page and a keystone test.

### 4. Pin the browser build

Screenshots are byte-identical per Chromium build. Record the build in the workspace config and have `pack --check` report a build mismatch as its own failure, so a Playwright bump never shows up as a thousand changed images. This also unblocks the held `playwright-core` Dependabot pull request, which needs a determinism run CI cannot do today.

Done when a workspace records its browser build and a mismatch fails with both build names instead of a pixel diff.

### 5. Record a flow from a session

Authoring is the slowest step. The plugin lets an agent write a flow from a prompt. Add a recorder: drive the app once in a headed browser (or hand over a browxai session), write the steps as a flow file with stable locators, and leave the agent to polish captions. This narrows the gap with Scribe and Tango on first-use effort and keeps replay deterministic.

Done when a new record command writes a runnable flow file from one session and `run` passes first try on the example app.

### 6. Viewer preview per pull request

`render` builds a local viewer. Add a Netlify and Cloudflare Pages recipe that deploys the viewer per pull request. Cheap, and it makes the output linkable in review.

Done when a recipe in `docs/ci-recipes.md` posts a preview URL on the pull request.

### 7. Variant coverage grid

The matrix runs locale by scheme by viewport. Print a grid in the `run` output and the viewer that shows which variants exist for each flow and which are stale. Helps teams that ship in several languages see the gap at a glance.

Done when `run` prints the grid and the viewer has a variant picker with a missing marker.

## Not now

- A hosted docsxai service. It needs billing, accounts and data handling decisions that belong to the owner.
- Video output. Guidde and Trupeer own it, and deterministic video is a separate research project.
- A visual editor for flows. The flow file in git is the point.

## Order of work

1. Land rc.5. The signed tag and npm approvals are with the owner.
2. Build 1 and 3. They need no new accounts and strengthen the core claim.
3. Take 2 once the owner confirms the first release of each package.
4. Revisit this list after the first adopter report lands in `docs/ai-context/adopter-reports`.
