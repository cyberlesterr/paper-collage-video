# Provider Selection and Provenance

Read this only when discovering, confirming, changing, invoking, or recording a text/image/voice/sound provider.

## Discover and Confirm Once

Run `npm run provider:status -- <slug> --compact-json`, then verify recorded host tool ids against the current registry. `agent-check-required` is expected for a callable host provider; `error` is a real configuration problem. Do not probe availability with a paid call.

Collect text/image/voice selections with the combined scenario/concept decision;
also collect `sound` when the compiled `sound-effect-plan.json` is non-empty.
`provider:status` reports `requiredCapabilities` and computes `allConfirmed`
from that project-specific set, so an unused optional sound provider does not
block production. Run `project:confirm-concept`. The initial
aspect/style/parallax intake never selects or authorizes providers. Use project
scope unless the human explicitly asks to remember a workspace-wide choice.
Never request or store secrets; command providers name environment variables
in `requiredEnv`.

Use `provider:select` only for an isolated change or fallback. A provider switch or generated-image budget increase returns to the existing human decision; deterministic derivatives within an approved source family do not.
After an explicit post-concept budget decision, run
`npm run project:increase-image-budget -- <slug> --limit=<exact-total-cap> --note=<human-decision>`.
It is increase-only, audits current used/reserved attempts, preserves the
original scenario proposal, and cannot exceed the profile hard ceiling.

## Adapter Types

| Adapter | Use | Execution |
|---|---|---|
| `host` | Current host tool, skill, model, or app (Codex, Claude, etc.) | Invoke, write local output, then `provider:record` |
| `command` | User CLI/wrapper/private adapter | `provider:run` executes without a shell and records success |
| `manual` | Authorized supplied or deterministic local asset | Copy/derive output, then `provider:record` |

For any selected host `image`, `voice`, or `sound` provider, record the actual
callable tool plus a verified `outputAcquisition` mode:
`local-file` or `public-download-url`, with concrete evidence and timestamp.
A login-protected preview/download page is not an output contract. Do this
before provider confirmation, not after a paid call has already completed.

`project:storyboard` compiles each non-empty `beat.soundCue` into a deduplicated
sound asset, schema-v8 request, and exact scene/beat/event binding. Reused cues
share one provider call; changed or removed cues delete their superseded
requests in the same transaction. Sound requests require `soundBinding`, and
recording probes the returned audio before manifest provenance is committed.

## Schema-v8 Image Requests and Reuse

Every new image request uses schema v8 and requires the current project's exact
`styleProfileBinding`, `compositionBinding`, `semanticBinding`, explicit
`outputSurface`, and `quality`. Copy the binding from the frozen profile rather
than paraphrasing it, include every binding directive verbatim in `prompt`, and
include every `styleProfile.quality.requiredAssetChecks` value in
`quality.requiredChecks`. The binding covers positive, negative, and
composition directives; its fingerprint makes style changes invalidate reuse.
Use `alpha` only when the file must contain real transparent pixels,
`chroma-key` with a declared edge key color, `opaque` for a fully opaque plate,
or `layer-sheet` for the mixed surface of a registered 2×2 source. In a layer
sheet, reference/rear cells are
opaque and subject/front cells use real alpha or a declared flat chroma key.
For host image models without reliable native alpha, chroma key is the default:
choose a color absent from every cutout (often `#ff00ff` for yellow/green paper),
require a uniform untextured plane, and require every internal negative space
to show that same color. Registration rejects baked checkerboards, false alpha,
unexpected transparency, and missing/unreliable per-cell chroma planes. When a
host tool nevertheless returns a complete alpha-intended source over a neutral
baked transparency checkerboard, close the consumed attempt as rejected,
preserve the raw RGB file, and run `provider:recover-rejected-source --check`
with `surfaceRecovery.mode=baked-checkerboard-alpha` and
`policyId=checkerboard-alpha-v1`. Only a deterministic derivative may remove
that observed surface. A free
asset names its scene/node/role/canvas. Critical content binds a ready project
semantic contract. Older request schemas are rejected rather than migrated.

Before authoring any rear/subject/front request, compile the storyboard source
package and read [layer-complete-assets.md](layer-complete-assets.md). A
`registered-depth-stack` request also carries the exact compiler-owned
`layerPackageBinding`. It identifies one stable source package, registration,
source strategy, all three complete members, shared canvas, reveal envelopes,
and context-preserving recovery policy.

Before authoring a rigid-frame/internal-state request, compile its
`canonicalContainers[]` source package and read
[canonical-containers.md](canonical-containers.md). Each of its three provider
roots carries the same `containerPackageBinding`; only `packageRole`,
`assetId`, output role/surface, canvas, prompt directive, and role-specific
checks differ. The content sheet canvas is the registered cell canvas
multiplied by its declared grid. It is one complete provider root, never one
request per fill state.

For `path-locomotion`, the route, heading, camera follow, and aspect-ratio
adaptation are runtime behavior and never image-provider work. Generate only
the smallest complete registered locomotion family needed for the cycle,
normally one 2×2 four-phase sheet with one canonical forward axis. Reuse those
same registered cells at every path heading through tangent rotation. Do not
request up/down/left/right/diagonal copies unless a real asymmetric semantic
change makes rotation invalid. This preserves identity and converts eight
directional variants into one provider root plus deterministic local
derivatives.

A host image provider may return a larger provider-native canvas for a complete
state sheet. Record that untouched source when it is at least the requested
size, preserves the requested aspect ratio, and divides evenly by the declared
state-sheet rows and columns. The state-sheet processor then uses the actual
provider canvas for deterministic equal-grid or explicit-rectangle extraction.
Reject a smaller canvas, a changed aspect ratio, or dimensions that cannot be
divided into the declared grid. Do not resize the provider root before
`provider:record`.

For an ordinary image whose provider-native canvas may differ from the delivery
canvas, declare the behavior once per provider in `providers.json`:

```json
"host-image": {
  "label": "Host image generation",
  "adapter": "host",
  "nativeCanvas": {
    "minimumWidth": 960,
    "minimumHeight": 540,
    "aspectRatioTolerance": 0.02
  }
}
```

With that declaration, `provider:record` automatically accepts a native-size
result for any request that does not carry its own `providerSource` policy:
it validates the minimum size and aspect tolerance, records the observed raw
and target canvases plus an observation fingerprint, and never rejects the
paid call for a size mismatch alone. A per-request root
`providerSource.mode=provider-native` (with explicit minimums, tolerance, and
`normalization={method:"deterministic-resize",targetCanvas:{...}}`) still
overrides the provider default when one asset needs different bounds. Keep
the provider result byte-for-byte unchanged, then run:

```bash
npm run assets:normalize-provider-source -- --spec=projects/<slug>/provider-source-normalization/<asset>.json
```

The command creates an active `provider-source-derivative` with exact target
dimensions and a SHA-bound normalization record while preserving the raw
provider source in history. This is a deterministic zero-call derivative, not
a provider retry and not permission to stretch a wrong-aspect or undersized
image.

```json
{
  "$schema": "../../../schemas/asset-request.schema.json",
  "schemaVersion": 8,
  "projectSlug": "example",
  "assetId": "boat-layer-sheet",
  "capability": "image",
  "output": "public/projects/example/assets/boat/layer-sheet.png",
  "prompt": "Use visible hand-drawn ink contours, cut-paper edges, and graphic explanatory marks. Build clear modular layers that can support annotations, mechanisms, and lively local motion. Avoid: Polished corporate vectors, photorealism, and unstructured decorative clutter. Composition: Give the hero action a strong silhouette and reserve clean space for explanatory graphics. Composition: Mix imperfect paper geometry with disciplined visual hierarchy and explicit relationships. Create one registered 2x2 sheet: flat reference, clean rear plate, complete boat silhouette, complete front wave overlay.",
  "styleProfileBinding": {
    "schemaVersion": 1,
    "id": "hand-drawn-cutout-explainer",
    "catalogVersion": "2026-07-27.1",
    "profileFingerprint": "6c415494cdad395860cdd2576c330f0abe4cdf3a29a101baf4e7c19ff84e02b2",
    "directives": [
      "Use visible hand-drawn ink contours, cut-paper edges, and graphic explanatory marks.",
      "Build clear modular layers that can support annotations, mechanisms, and lively local motion.",
      "Avoid: Polished corporate vectors, photorealism, and unstructured decorative clutter.",
      "Composition: Give the hero action a strong silhouette and reserve clean space for explanatory graphics.",
      "Composition: Mix imperfect paper geometry with disciplined visual hierarchy and explicit relationships."
    ]
  },
  "outputSurface": {"mode": "layer-sheet"},
  "compositionBinding": {
    "sceneId": "scene-01",
    "nodeId": "boat-depth-stack",
    "pattern": "registered-depth-stack",
    "outputRole": "registered-sheet",
    "registrationId": "boat-family-01",
    "sourceMasterAssetId": "boat-master",
    "canvas": {"width": 2048, "height": 2048},
    "derivation": {
      "method": "provider-generation",
      "parentAssetId": "boat-master"
    }
  },
  "layerPackageBinding": {
    "sourcePackageId": "scene-01-boat-depth-stack",
    "pattern": "registered-depth-stack",
    "motionCapability": "bounded-relative",
    "sourceStrategy": "registered-layer-sheet",
    "packageRole": "registered-sheet",
    "registrationId": "boat-family-01",
    "sourceMasterAssetId": "boat-master",
    "canvas": {"width": 1024, "height": 1024},
    "completeness": null,
    "memberAssetIds": ["boat-rear", "boat-subject", "boat-front"],
    "referenceAssetIds": ["boat-master"],
    "sheetLayout": {
      "columns": 2,
      "rows": 2,
      "providerSource": {
        "canvasMode": "provider-native",
        "minimumWidth": 1024,
        "minimumHeight": 1024,
        "cellExtraction": "explicit-rects"
      },
      "cells": [
        {"packageRole": "reference", "row": 0, "column": 0, "outputSurface": {"mode": "opaque"}},
        {"packageRole": "support-rear", "row": 0, "column": 1, "outputSurface": {"mode": "opaque"}},
        {"packageRole": "subject", "row": 1, "column": 0, "outputSurface": {"mode": "chroma-key", "keyColor": "#ff00ff", "tolerance": 24}},
        {"packageRole": "support-front", "row": 1, "column": 1, "outputSurface": {"mode": "chroma-key", "keyColor": "#ff00ff", "tolerance": 24}}
      ]
    },
    "recoveryPolicy": {
      "completeSourceContext": true,
      "localDeterministicFixFirst": true,
      "isolatedMemberGeneration": "forbidden",
      "providerRepair": "masked-complete-source-edit",
      "fallback": "full-source-regeneration"
    }
  },
  "semanticBinding": {"riskClass": "topology-critical", "contractIds": ["boat-topology"]},
  "quality": {
    "kind": "image",
    "requiredChecks": [
      "style-consistent",
      "style-profile-conformant",
      "subject-complete"
    ]
  }
}
```

For a layer-complete family, use exactly one of the two source strategies
defined in `layer-complete-assets.md` (`registered-layer-sheet` or
`context-preserving-layer-edits`); that document owns each strategy's cell
contents, member completeness, and per-strategy costs.

The manifest records the untouched provider root and three local derivatives,
then computes one family fingerprint. If the provider emits its native size or
adds separators, keep that raw file unchanged and declare each accepted
`sourceRect`, destination `placement`, and any keying parameters in the
registered-family spec. The CLI writes `<member>.png.key.json` for keyed cells
and fingerprints that metadata. Do not resize, key, or silently replace the
provider output before `provider:record`. A composed flat reference is
comparison evidence, not a valid pixel source for independently moving layers.
Masking its visible pixels cannot reconstruct hidden rear or subject content.

For a rejected full-context chroma edit that is at most one pixel short per
axis, the same no-mutation rule applies: recover the untouched provider output
as a `recovery-source`, then use observed-key provenance and an explicit
actual-size placement to create the full registration-canvas derivative. Never
apply this narrow edge recovery to an opaque clean rear plate or larger drift.

Do not make isolated text-to-image calls for registered members. For two or
more poses/states of one identity, prefer one `stateSheetBinding` request with
an explicit grid and the required `preserve-sheet-context` policy, then run
`assets:process-state-sheet`. This converts one provider image into registered
local state files without trimming their shared cell canvas. The processor
records each derivative and a family fingerprint; those local crops do not
consume more generation attempts. Do not put unrelated identities in one sheet
merely to reduce cost.

For a `supported-subject` or `registered-depth-stack` family, do not hand-fill
three manifest records. Author one schema-v2 file against
`schemas/registered-family.schema.json` and run:

```bash
npm run assets:derive-registered-family -- projects/<slug>/registered-families/<family>.json
```

Its source must be the registered layer sheet, the three full-context
layer-package members from the compiled source strategy, or—for a stateful
subject only—an active real-alpha `state-sheet-cell` produced from the complete
registered pose sheet. A state-cell source must declare the exact
`poseFamilyId`/`stateId` and an explicit placement on the shared family canvas;
derive one complete rear/subject/front family for every subject state. The CLI materializes
exactly `support-rear`, `subject`, and `support-front`, keeps the registration
canvas and top-left origin, validates clean-plate/full-silhouette/full-overlay
completeness, appends `registered-family-member` provenance, supersedes prior
active records for the same asset ids, and optionally patches matching
authoring nodes. It reports actual upstream provider image calls, deterministic
local derivatives, and calls avoided from manifest provenance. A flat composed
master, tight image, isolated member, or role/slot/canvas/source-family mismatch
is rejected.

Its required recovery policy is `preserve-family-context`: rerun deterministic
local processing first; if new pixels are required, edit a mask while retaining
the complete source sheet/reference as provider context; if that is unreliable,
regenerate the complete source. Never generate one replacement member in
isolation.

For recovery, follow this order:

1. rerun local splitting/keying when no new pixels are needed;
2. create a schema-v8 `masked-sheet-edit` request that preserves the exact current `styleProfileBinding`, names the complete recorded sheet as `stateSheetRecoveryBinding.sourceSheetAssetId`, uses the same id as `compositionBinding.derivation.parentAssetId`, includes it in `generationFamily.referenceAssetIds`, supplies a full-canvas `maskAssetId`, and names only the failed `targetStateIds`;
3. if untargeted cells cannot remain unchanged, create a `full-sheet-regeneration` request whose target ids equal every member of the state sheet.

The validator rejects a provider-generation/edit request for one `stateBinding` when its generation family contains multiple states. A masked edit also requires `identity-family-consistent`, `cell-separation`, `reference-conformant`, and `untargeted-cells-unchanged`; quality preparation compares untargeted source and result pixels. This is context-preserving regional repair, not isolated cell generation.

Reuse requires the whole composition binding to match, so an unrelated water image cannot enter a registered river family merely because it looks similar.

```bash
npm run provider:reuse -- --request=projects/<slug>/requests/<asset>.json
npm run provider:request -- validate --request=projects/<slug>/requests/<asset>.json --json
npm run provider:attempt -- reserve --request=projects/<slug>/requests/<asset>.json --provider=<id> --json
npm run provider:attempt -- summary --project=<slug> --json
npm run provider:run -- --request=projects/<slug>/requests/<asset>.json --provider=<id>
npm run provider:record -- --request=projects/<slug>/requests/<asset>.json --attempt-id=<attemptId>
npm run provider:recover-record -- --request=projects/<slug>/requests/<asset>.json --attempt-id=<closedSucceededAttemptId>
npm run provider:recover-rejected-source -- --spec=projects/<slug>/recovery/<asset>.json --check
npm run provider:recover-rejected-source -- --spec=projects/<slug>/recovery/<asset>.json
```

Try exact reuse before reserving an attempt. Validate the request first. `provider:attempt reserve --json` returns the canonical provider/model invocation mapping plus its fingerprint, so the host handoff does not need to guess connector ids. `provider:record` inherits provider/model from the attempt and rejects conflicting overrides. `provider:run` reserves automatically; a host tool call must use the explicit reserve command first. If a host result is abandoned instead of recorded, close it with `provider:attempt close` and state whether quota was consumed. When the ledger already says `succeeded` but manifest recording was interrupted, `provider:recover-record` verifies request/output identity and creates exactly one provenance record without consuming quota twice. Never delete or rewrite `generation-attempts.jsonl`.

Before a host production voice or sound call, run
`provider:request authorize --request=<request> --json`; it requires the
current visual-blueprint approval and returns the bound invocation. Production
voice is distinguished from a short fictional-voice audition by its required
`timingBinding`. Sound has no pre-blueprint exemption. Command adapters enforce
the same gate in `provider:run`, and `provider:record` refuses to accept output
that bypassed it.

Provider-native chroma output is allowed to approximate the requested prompt
color. New provider-native sheet requests must declare
`keyPlane={mode:"provider-native-observed",policyId:"flat-v1"}` for every
chroma cell. Verification rejects absent, gradient, checkerboard,
multi-cluster, disconnected, boundary-poor, or foreground-confusable planes;
accepted records retain requested/observed colors and all policy/statistics
fingerprints. Future rejected records retain the raw output SHA.

`provider:recover-rejected-source` is distinct from `recover-record`. It
requires a consumed `rejected` attempt, the unchanged historical request and
raw output, an explicit expected SHA, and either complete keyed cell rectangles
with passing observed-plane evidence or one complete alpha-intended image with
passing `checkerboard-alpha-v1` evidence. `--check` writes nothing. Recording appends one
manifest `recovery-source` record but performs zero provider calls, does not
reserve budget, does not append/rewrite the ledger, and does not change the
attempt status. Derivation may consume that full sheet; isolated member
recovery remains forbidden.

Creative Plan v4 distinguishes the selected scenario's complete expected image
calls, the profile's
`assetBudget.maxGeneratedImages` planning ceiling from
`approvedImageBudget.imageAttemptLimit`. The combined concept selection must
include the exact `scenarioDecision` and `budgetDecision.imageAttemptLimit`;
scenario-bound confirmation requires that cap to equal the approved scenario
card, cover expected calls including the story-specific style sample, and stay
below the profile ceiling. Reservation
must fail when this approval is absent and must enforce the approved cap even
when the profile ceiling is larger. `provider:attempt summary --json` is the
read-only proof surface for ceiling, approved cap, used, reserved, and remaining
attempts.

The manifest owns accepted asset provenance. The append-only attempt ledger owns real generation usage, including rejected and abandoned results. Production scheduling stays in `production.json`.

## Preflight Production Narration

Add `timingBinding` to every production (non-audition) voice request. Use the storyboard scene id and a minimum and/or maximum duration derived from the approved scene allocation after reserving narration start, meaningful action, and bounded tail time:

```json
{
  "capability": "voice",
  "timingBinding": {
    "sceneId": "scene-01",
    "minDurationSeconds": 8,
    "maxDurationSeconds": 12.5
  }
}
```

`provider:record` and command adapters probe the real media before provenance is committed. An output outside the bound remains on disk for diagnosis but is rejected from the manifest; revise text or voice speed and generate a fitting take. Style auditions do not need `timingBinding`.
