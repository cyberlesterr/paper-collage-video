# Semantic Production Contracts

Read this before generating recurring characters, articulated subjects, functional objects, or explanatory diagrams. A prompt requests an image; a semantic contract defines what must be true and what evidence must prove it.

## Classify Risk Before Generation

Use one dominant `semanticBinding.riskClass` per schema-v3 image request, then bind every additional applicable contract in `contractIds`. The runtime unions the asset checks from all bound contract kinds. If any bound contract is `identity`, declare `generationFamily` even when identity is not the dominant risk.

`decorative` is valid only when `contractIds` is empty. If a plate contains a named subject, meaningful negative space, a working mechanism, or an explanatory diagram, classify it by the dominant critical risk instead of calling the whole plate decorative.

| Risk | Use for | Required reusable contract |
|---|---|---|
| `decorative` | texture, clouds, foliage, non-semantic ornament | none |
| `identity-critical` | named/recurring people, animals, or objects | `identity` |
| `topology-critical` | articulated silhouettes, holes, spokes, limbs, ropes, internal negative space | `topology` |
| `mechanism-critical` | scales, pulleys, wells, carts, levers, tools, machines | `mechanism` |
| `diagram-critical` | labels, arrows, step cards, ledgers, explanatory icons | `diagram` |

Do not downgrade a critical subject because it is baked into a full-frame plate. Composition `pattern` controls layer relationships; semantic `riskClass` controls content correctness.

## Lock the Contract

Write a project-local input, then validate and lock it without adding a human gate:

```bash
npm run project:semantic-contracts -- <slug> --input=projects/<slug>/semantic-contracts-input.json
```

Every contract needs invariants plus one or more `evidenceTargets`. Each evidence target names the exact scene/node/proof ids and the semantic checks that must be reviewed. Cross-scene identity continuity must include shots from at least two scenes.

Topology, mechanism, and diagram contracts must cover every check defined for their kind across their evidence targets. Every `coexistenceSet` scene must have an `identity-distinct-within-frame` target shot; a character list without same-frame proof is not sufficient.

## Identity Contract

Give each recurring member at least three visual fingerprint categories. For members that coexist, vary at least two categories; palette alone is not sufficient.

```json
{
  "id": "recurring-cast",
  "kind": "identity",
  "title": "Recurring cast",
  "invariants": ["Each named member remains recognizable across scenes"],
  "members": [
    {
      "id": "elder-scholar",
      "label": "Elder scholar",
      "fingerprint": {
        "faceOrFront": "square face and heavy brows",
        "bodyOrProportion": "broad shoulders",
        "headOrTop": "low cloth cap",
        "facialHairOrDetail": "short square beard",
        "palette": ["dark red"],
        "distinguishingFeatures": ["wide sleeves"]
      }
    },
    {
      "id": "young-engineer",
      "label": "Young engineer",
      "fingerprint": {
        "faceOrFront": "long narrow face",
        "bodyOrProportion": "slender",
        "headOrTop": "tall black crown",
        "facialHairOrDetail": "pointed goatee",
        "palette": ["olive brown"],
        "distinguishingFeatures": ["narrow sleeves"]
      }
    }
  ],
  "coexistenceSets": [{"sceneId": "scene-01", "memberIds": ["elder-scholar", "young-engineer"]}],
  "evidenceTargets": [
    {
      "id": "cast-comparison",
      "checks": ["identity-distinct-within-frame", "cross-scene-identity-continuity"],
      "shots": [
        {"sceneId": "scene-01", "nodeId": "cast", "proofTimeIds": ["final"]},
        {"sceneId": "scene-05", "nodeId": "cast", "proofTimeIds": ["final"]}
      ]
    }
  ]
}
```

Keep `generationFamily` independent from `compositionBinding`. A full-frame `free` plate may still belong to a recurring identity family:

```json
"semanticBinding": {
  "riskClass": "identity-critical",
  "contractIds": ["recurring-cast"],
  "generationFamily": {
    "familyId": "cast-family-01",
    "memberIds": ["elder-scholar", "young-engineer"],
    "referenceAssetIds": ["cast-reference-sheet"]
  }
}
```

## Mechanism Contract

Model a functional object as parts, connections, degrees of freedom, load paths, forbidden forms, and reference evidence. Every consecutive pair in a load path must have a declared connection.

```json
{
  "id": "working-well-hoist",
  "kind": "mechanism",
  "title": "Working well hoist",
  "invariants": ["The bucket load transfers through the rope and axle into the frame"],
  "parts": [
    {"id": "frame", "label": "Frame", "role": "fixed"},
    {"id": "axle", "label": "Axle", "role": "moving"},
    {"id": "rope", "label": "Rope", "role": "connector"},
    {"id": "bucket", "label": "Bucket", "role": "load"}
  ],
  "connections": [
    {"from": "frame", "to": "axle", "type": "supports"},
    {"from": "axle", "to": "rope", "type": "contacts"},
    {"from": "rope", "to": "bucket", "type": "suspends"}
  ],
  "loadPaths": [{"id": "load-chain", "sequence": ["frame", "axle", "rope", "bucket"], "force": "bucket weight and frame reaction"}],
  "degreesOfFreedom": ["axle rotates while the frame remains fixed"],
  "forbiddenForms": ["rope ends without connecting the axle and bucket"],
  "references": [{"label": "construction reference", "source": "authoritative source or licensed local reference", "note": "Parts and connections verified before generation"}],
  "evidenceTargets": [{"id": "hoist-final", "checks": ["mechanism-complete", "load-path-readable", "physical-plausibility", "reference-conformant"], "shots": [{"sceneId": "scene-05", "nodeId": "well-hoist", "proofTimeIds": ["final"]}]}]
}
```

Do not mark `physical-plausibility` or `reference-conformant` passed from prompt text. Inspect the final-resolution crop against the declared parts, connections, motion, forbidden forms, and reference evidence.

## Diagram Contract

Protect text, icons, arrows, and borders from procedural filters. A diagram contract must forbid `feTurbulence`, `feDisplacementMap`, and `feBlend`; the runtime rejects these features anywhere in a diagram-critical SVG.

Use static paper color/texture behind semantic content. Render at the declared final canvas in Chromium and inspect the target crop for:

- `diagram-edge-clean`
- `small-text-legible`
- `no-procedural-noise-on-semantic-lines`

Raster diagrams cannot be XML-linted, so all three checks still require original-resolution evidence.

## Topology Contract

Name the required visible parts and negative spaces of articulated or internally open subjects. Topology evidence targets use only these exact checks:

- `silhouette-fidelity`
- `negative-space-clean`
- `background-leak-free`

Continue to use `supported-subject` or `registered-environment` when layers touch or share boundaries; the topology contract does not replace v4 registration and source-master rules. Do not invent synonymous check names because the quality recorder rejects unknown enums.

## Evidence Rules

- Run `project:composition-proof` after real assets and timings are assembled. It clears stale proof output and renders every semantic evidence target.
- Record evidence-backed checks with the generated full frame, target crop, and debug frame.
- Any contract, bound asset, proof time, cue, node, or referenced file change invalidates the semantic target fingerprint.
- A vision model may assist detection, but it is not sole authority for physical/historical correctness. The recorded review must state what was compared.
