# Paper Collage Composition Contract v4

Status: implemented and validated
Date: 2026-07-20

## 1. Problem

Project schema v3 models a scene as a background plus flat character and environment arrays. Each entry has an independent world-space transform, keyframe path, and z-index. The renderer can place one complete sprite in front of or behind another, but cannot express partial occlusion, a shared parent transform, a support contact, or a shared semantic boundary.

That limitation produced two representative failures in `ke-zhou-qiu-jian`:

- the traveler and boat were valid independent PNGs, but no ordering could place the lower body behind the gunwale while keeping the upper body in front;
- the background, bank, water, and reeds were independently authored full-frame layers without a shared shoreline, so water could cover trees and duplicate landscape content already present in the background.

The v3 quality report correctly proved individual file properties. It did not prove relationships between files. Therefore a fully passing asset report could still produce an invalid composite.

This is a production-contract defect, not a one-project art-polish defect.

## 2. Goals

v4 must:

1. declare spatial and semantic relationships before coupled assets are generated;
2. render attached objects through shared parent transforms and local child transforms;
3. support partial occlusion through explicit front and rear slots or masks;
4. keep environment layers registered to one master canvas and shared boundaries;
5. make audiovisual cues a single deterministic event source;
6. separate per-file asset quality from cross-layer composite quality;
7. prove the actual production assembly at authored establish, action, and final times;
8. preserve the existing three human gates rather than add a fourth approval;
9. keep the Skill concise by placing fragile operations in deterministic scripts and detailed contracts in stage-specific references;
10. forward-test the reusable workflow on a new story rather than hand-perfect the original test project.

## 3. Non-goals

v4 will not:

- migrate or execute v3 project data;
- replace Remotion with HyperFrames, p5.js, or another renderer;
- add mouse interaction, scroll triggers, or an interactive-video delivery mode;
- add animation-library adapters unrelated to paper collage;
- promise that geometry checks can replace visual judgment;
- add a new human approval stage;
- repair `ke-zhou-qiu-jian` with project-specific z-index or coordinate patches.

## 4. Design decisions

### 4.1 Replace flat scene arrays with one bounded composition tree

`project.json` advances directly to schema version 4. `scene.background`, `scene.environmentLayers`, and `scene.layers` are removed. Every visible scene element lives in `scene.composition.nodes`.

The tree has two primitives:

- `asset`: one visible source with a local transform and optional local keyframes;
- `group`: a parent coordinate space with a bounded composition pattern and child assets.

The allowed group patterns are deliberately small:

| Pattern | Use | Required relationship |
|---|---|---|
| `free` | independent labels, leaves, birds, stamps, and other non-contact cutouts | no support or shared boundary |
| `supported-subject` | a person in a boat, an animal on a cart, a hand holding a prop | rear support, subject, front occluder, and support anchor |
| `registered-environment` | bank and water, ground and sky, mountain bands, room planes | shared master canvas, registration, and boundary masks |

New patterns require a schema, validator, renderer implementation, fixtures, and Skill routing rule. Agents must not invent pattern names per project.

### 4.2 Use local coordinates inside groups

Every group defines one parent box in scene coordinates. Children use coordinates local to that group. The runtime applies transforms in this order:

1. scene camera;
2. group base transform;
3. group keyframe and cue transform;
4. child base transform;
5. child keyframe and cue transform.

The camera and group transforms are each applied once. An attached child must not repeat the carrier's world-space motion.

`z` is local to the parent. Child ordering never depends on unrelated scene-global z values.

### 4.3 Treat coupled assets as one registered source family

Assets that share a contact, occlusion, or semantic boundary are coupled. Coupled members must share:

- `registrationId`;
- source canvas dimensions and origin;
- `sourceMasterAssetId`;
- the same generation or reference-guided master composition;
- a compound fingerprint covering the master, derived members, and composition config.

Independent text-to-image calls are forbidden for coupled members. The normal path is:

1. generate or import one complete master composition;
2. derive rear, subject, occluder, band, or mask outputs from that master;
3. record every derivative against the same source family;
4. render derivatives without independent `object-fit: cover` registration.

Deterministic crops, masks, and alpha extractions do not consume generated-image budget. A new provider generation does.

### 4.4 Make proof a relationship contract

Storyboard proof moments remain normalized scene times. v4 adds relationship assertions to those moments. A proof is not complete merely because a frame was rendered; it must name what the pixels prove.

Examples:

- establish: traveler visibly supported inside the boat;
- action: sword crosses the gunwale and reaches the water surface;
- final: carved mark remains on the moved boat while the river location is visibly behind it;
- boundary: tree trunks remain on the bank side of the shoreline mask.

The final proof remains at or after `at=0.82` and is part of the scene result, not cleanup.

## 5. v4 project contract

### 5.1 Scene shape

The intended top-level shape is:

```json
{
  "schemaVersion": 4,
  "scenes": [
    {
      "id": "scene-01",
      "motion": {
        "blueprint": "chapter-tableau",
        "seed": 1042,
        "proofTimes": []
      },
      "composition": {
        "coordinateSpace": {"width": 1920, "height": 1080},
        "nodes": []
      },
      "camera": {},
      "transition": {},
      "narration": {},
      "subtitles": [],
      "cues": []
    }
  ]
}
```

All node ids are unique within the scene. Cue targets may reference a group or asset node. Group-targeted cues affect the whole registered assembly.

### 5.2 Asset node

```json
{
  "id": "traveler",
  "kind": "asset",
  "src": "projects/example/assets/characters/alpha/traveler.png",
  "slot": "subject",
  "registrationId": "boat-family-01",
  "transform": {
    "x": 0.54,
    "y": 0.57,
    "width": 0.29,
    "anchorX": 0.5,
    "anchorY": 1
  },
  "motion": {
    "keyframes": [
      {"at": 0, "y": 0},
      {"at": 1, "y": -0.008}
    ]
  }
}
```

Local `x`, `y`, `width`, and anchors are normalized to the parent coordinate space. Asset keyframes are local deltas. Pixel values are reserved for source inspection and registration metadata.

### 5.3 Supported-subject group

```json
{
  "id": "boat-rig",
  "kind": "group",
  "pattern": "supported-subject",
  "registration": {
    "id": "boat-family-01",
    "sourceMasterAssetId": "boat-with-traveler-master",
    "canvas": {"width": 1600, "height": 900},
    "origin": "top-left"
  },
  "transform": {
    "x": 0.18,
    "y": 0.42,
    "width": 0.68,
    "anchorX": 0.5,
    "anchorY": 0.5
  },
  "support": {
    "subjectId": "traveler",
    "contactAnchor": {"x": 0.54, "y": 0.72},
    "contactZone": [[0.35, 0.58], [0.72, 0.58], [0.78, 0.82], [0.3, 0.82]],
    "occlusionZone": [[0.28, 0.61], [0.8, 0.61], [0.82, 0.86], [0.25, 0.86]]
  },
  "children": [
    {"id": "boat-rear", "kind": "asset", "slot": "support-rear"},
    {"id": "traveler", "kind": "asset", "slot": "subject"},
    {"id": "contact-shadow", "kind": "asset", "slot": "contact-shadow"},
    {"id": "front-gunwale", "kind": "asset", "slot": "support-front"}
  ]
}
```

Required draw order is rear support, contact shadow, subject, front support. The schema allows the shadow to be omitted; the other three slots are mandatory.

The front support must have visible alpha inside the declared occlusion zone. The subject contact anchor must lie inside the contact zone at every proof time unless the storyboard explicitly declares a detach action.

### 5.4 Registered-environment group

```json
{
  "id": "river-environment",
  "kind": "group",
  "pattern": "registered-environment",
  "registration": {
    "id": "river-family-01",
    "sourceMasterAssetId": "river-master",
    "canvas": {"width": 1920, "height": 1080},
    "origin": "top-left"
  },
  "boundaries": [
    {
      "id": "shoreline",
      "upperMaskSrc": "projects/example/assets/environments/river/shoreline-upper-mask.png",
      "lowerMaskSrc": "projects/example/assets/environments/river/shoreline-lower-mask.png",
      "upperSemantic": "land",
      "lowerSemantic": "water"
    }
  ],
  "children": [
    {
      "id": "far-landscape",
      "kind": "asset",
      "slot": "far",
      "semanticCoverage": ["sky", "distant-land"]
    },
    {
      "id": "riverbank",
      "kind": "asset",
      "slot": "upper-band",
      "semanticCoverage": ["foreground-bank", "tree-line"],
      "clip": {"boundaryId": "shoreline", "side": "upper"}
    },
    {
      "id": "water-texture",
      "kind": "asset",
      "slot": "lower-band",
      "semanticCoverage": ["water-surface"],
      "clip": {"boundaryId": "shoreline", "side": "lower"}
    },
    {"id": "foreground-reeds", "kind": "asset", "slot": "foreground"}
  ]
}
```

All registered children use the full master canvas and origin. A texture may move within its clip, but the clip boundary remains attached to the group. This permits water motion without moving the shoreline over tree trunks.

The background must not duplicate a complete semantic region supplied by another child. Every registered child declares `semanticCoverage`; the validator rejects duplicate exclusive declarations, while composite visual review verifies that the declarations match the pixels. A far landscape may contain distant land and sky, but it must not also contain the same foreground bank, water ribbon, or reeds supplied as registered children.

### 5.5 Cue event contract

`scene.cues` remains the sole authored source for timed actions and sound. v4 adds an optional proof binding:

```json
{
  "id": "sword-hits-water",
  "beatId": "beat-sword-falls",
  "at": 0.46,
  "durationSeconds": 0.7,
  "targetId": "sword",
  "action": "drop-impact",
  "intensity": 1,
  "proofTimeId": "proof-impact",
  "sound": {
    "src": "projects/example/assets/audio/sword-splash.wav",
    "volume": 0.8
  }
}
```

The runtime derives both visual action and sound scheduling from the same cue. Reports emit a deterministic cue event table. A storyboard beat that names an audio cue must produce exactly one matching sound event. The bound proof time must fall within the cue action window.

New cue actions such as `drop-impact` or `carve` must be registered in one action catalog used by schema, validation, runtime, report, and Skill reference. They must not be implemented as duplicated lists.

## 6. Storyboard composition plan

Each storyboard scene adds a compact `compositionPlan` before asset production:

```json
{
  "compositionPlan": {
    "patterns": ["registered-environment", "supported-subject"],
    "relationships": [
      {
        "subject": "traveler",
        "predicate": "inside",
        "object": "boat",
        "proof": "lower body is behind the front gunwale"
      },
      {
        "subject": "trees",
        "predicate": "above-boundary",
        "object": "shoreline",
        "proof": "trunks and roots remain on land"
      }
    ]
  }
}
```

The plan is approved with the existing concept/storyboard decision. It describes meaning in human-readable terms and bounded pattern names; it does not expose raw production coordinates to the human.

Skill routing rules are mandatory:

- `inside`, `on`, `held-by`, `worn-by`, or another persistent contact selects `supported-subject`;
- two layers sharing a shoreline, horizon, wall edge, tabletop edge, or another semantic boundary select `registered-environment`;
- only elements with no persistent contact or boundary may remain `free`;
- if a relationship cannot be represented by an existing pattern, stop before bulk asset generation and extend the reusable contract instead of faking it with z-index.

## 7. Asset request and provenance changes

`asset-request.schema.json` advances to version 2 and adds `compositionBinding`:

```json
{
  "compositionBinding": {
    "sceneId": "scene-01",
    "nodeId": "front-gunwale",
    "pattern": "supported-subject",
    "registrationId": "boat-family-01",
    "sourceMasterAssetId": "boat-with-traveler-master",
    "outputRole": "support-front",
    "canvas": {"width": 1600, "height": 900}
  }
}
```

`assets-manifest.json` advances to version 3 and records:

- master and derivative relationships;
- registration id and source canvas;
- derivation method such as provider edit, alpha extraction, crop, or mask application;
- the provider/model/job of the master and any provider-edited derivative;
- file hash and request fingerprint;
- a compound family fingerprint.

Provider reuse is allowed only when the complete composition binding matches. A visually similar unregistered water layer is not reusable in a registered river family.

## 8. Quality model

`quality-report.json` advances to version 2 with two collections:

```json
{
  "schemaVersion": 2,
  "assets": [],
  "composites": []
}
```

### 8.1 Asset quality

Asset quality preserves the existing per-file technical and semantic checks:

- resolution, alpha, edge and file integrity;
- text, watermark, people, identity, completeness, style and safe area;
- SHA-256 invalidation after a file changes.

### 8.2 Composite quality

Each composite entry contains:

- `compositeId`, `sceneId`, and pattern;
- member node ids and current hashes;
- composition config hash;
- compound fingerprint;
- deterministic structural findings;
- proof frames and focused crops;
- semantic checks, reviewer, note, and status.

Required semantic checks are pattern-specific:

| Pattern | Checks |
|---|---|
| `supported-subject` | `support-contact`, `inside-or-on-readable`, `front-occlusion`, `shared-motion`, `identity-continuity` |
| `registered-environment` | `registration-aligned`, `boundary-respected`, `no-semantic-duplication`, `depth-readable`, `final-composition-readable` |
| cue relationship | `visual-event-visible`, `sound-event-bound`, `proof-time-bound`, `final-state-preserved` |

Changing any member file, mask, group transform, boundary, anchor, keyframe, cue, or proof time invalidates the composite review.

### 8.3 Deterministic structural checks

Validation blocks preview when:

- a group contains missing, duplicate, or cyclic node references;
- a supported subject lacks a rear, subject, or front slot;
- coupled members have different registration or source-master ids;
- a registered child has the wrong canvas dimensions or origin;
- an attached child duplicates the carrier's world-space motion;
- a support anchor lies outside its contact zone at a proof time;
- a front occluder has no alpha in its occlusion zone;
- an upper or lower environment layer crosses the forbidden side of a boundary beyond tolerance;
- the base and another registered child declare the same exclusive semantic band;
- a cue target does not exist, a required sound event is missing, or a bound proof time lies outside the action window.

Structural checks intentionally use geometry, alpha, hashes, and declared semantics. They do not claim to decide whether a composition looks elegant.

### 8.4 Composite proof artifacts

The production tooling creates:

- one full-resolution frame at every authored proof time;
- a focused crop for each declared relationship;
- an optional debug copy with group boxes, anchors, contact zones, mask boundaries, node ids, and local z order;
- a cue event table with normalized and absolute time;
- a compact composite report linked to current fingerprints.

Proof rendering uses the real project assets, real v4 renderer, real keyframes, and real cue path. A representative masked substitute cannot satisfy the gate.

## 9. Workflow integration

The human workflow remains:

1. concept, rhythmic storyboard, production profile, budget, and providers;
2. style, fictional voice, and a composition proof when the topology is materially new;
3. final assembled preview.

No fourth approval is added.

### 9.1 Style review

When a project contains `supported-subject` or `registered-environment`, the 3–5 second style proof must exercise at least one real coupled master, actual derivatives, and the v4 renderer. The sample appears in the existing style/voice decision.

### 9.2 Asset production

The internal production order is:

1. generate or import masters;
2. derive registered members and masks;
3. prepare and record asset quality;
4. assemble v4 groups;
5. render composite proofs and run structural checks;
6. record composite semantic quality;
7. generate narration/subtitles and finish cue bindings;
8. run `project:assets-ready` once.

`project:resume` may expose unfinished master, derivative, asset-review, or composite-review batches. These are machine work items, not human gates.

### 9.3 Assets-ready ownership

`project:assets-ready` continues to own the seal operation. It must:

1. synchronize real narration duration;
2. derive or import subtitle timing;
3. validate storyboard, v4 composition, cues, and media;
4. ensure proof artifacts match the current compound fingerprints;
5. enforce both asset and composite quality;
6. advance to preview only after all checks pass.

## 10. Renderer architecture

Replace the independent environment and character maps in `ReplicaChapterScene.tsx` with a recursive `CompositionNode` renderer.

Conceptual structure:

```text
Scene camera root
├── registered-environment group
│   ├── far landscape
│   ├── upper band clipped above shoreline
│   ├── lower texture clipped below shoreline
│   └── foreground
└── supported-subject group
    ├── support rear
    ├── optional contact shadow
    ├── subject
    └── support front occluder
```

Implementation requirements:

- groups establish relative positioning and local stacking contexts;
- masks and clips are deterministic CSS/SVG or precomputed alpha assets;
- registered assets render at their native shared canvas, not independent `object-fit: cover` transforms;
- texture animation occurs inside a fixed boundary mask;
- cue transforms compose with authored keyframes rather than replace them;
- seeded paper-life motion uses the existing scene seed and is reproducible at any frame;
- motion lookup remains a pure function of frame, fps, project data, and asset dimensions.

## 11. Tooling changes

Implementation should extend existing commands rather than create a fragmented operator workflow.

| Area | Change |
|---|---|
| `project:storyboard` | validate `compositionPlan` patterns and relationships |
| provider requests | write and validate composition bindings and source families |
| asset processing | add deterministic registered extraction/mask helpers where reusable |
| `project:quality prepare` | prepare both asset and composite entries after proof files exist |
| `project:quality record-batch` | accept hash-bound asset or composite reviews in one atomic batch format |
| composition proof | add one script invoked during asset production and rechecked by assets-ready |
| `project:assets-ready` | enforce current v4 validation, proof fingerprints, and both quality scopes |
| `project:report` | include cue event table and composite proof summary |
| `style:proof` | use actual v4 groups, emit current style fingerprints, full-resolution proof/crop/debug frames, and per-member alpha/checkerboard/tight/motion-stress evidence; style approval fails closed when evidence or semantic review is missing |
| `plugin:sync` | package all schema, runtime, script, fixture, reference, and starter changes |

Detailed schema examples and check catalogs belong in `references/project-contract.md` and `references/quality-motion.md`. The top-level Skill should only contain pattern-selection rules and the normal execution order.

## 12. Failure routing

| Failure | Normal response | Human reapproval? |
|---|---|---|
| missing group or wrong pattern | correct machine composition plan before bulk generation | no, when meaning is unchanged |
| independently generated coupled members | regenerate one master and derive the family | no, within approved profile budget |
| bad mask, crop, anchor, or extraction | redo deterministic derivation and composite proof | no |
| composite quality failure | repair only the affected family and invalidate its review | no |
| provider change or budget increase | preserve stage and request the existing provider/budget decision | yes |
| relationship meaning changes, such as moving a person from inside to beside a boat | return to concept/storyboard revision | yes |

Agents must not fix a relationship failure with arbitrary z-index nudges when the declared pattern or source family is wrong.

## 13. Test plan

### 13.1 Contract tests

- schema v4 accepts each legal pattern and rejects flat v3 scene arrays;
- node ids, parent references, slots, cue targets, and action catalog are consistent;
- registered family and compound fingerprints invalidate correctly;
- no v3 migration or compatibility branch exists.

### 13.2 Geometry and alpha tests

- local transforms compose with a group transform once;
- support anchor containment is checked at every proof time;
- front occluder intersection detects a missing gunwale;
- registered layers reject wrong dimensions, origin, or boundary side;
- mask-clipped texture motion cannot cross the semantic boundary.

### 13.3 Render fixtures

Add two minimal fixture families:

1. `supported-subject-fixture`: one correct person-in-boat rig plus broken variants with no front occluder, wrong anchor, independent motion, and mismatched registration;
2. `registered-river-fixture`: one correct bank/water stack plus broken variants with water above the mask, mismatched canvases, duplicate background content, and an unregistered independent layer.

Each correct fixture renders establish, action, and final frames. Each broken fixture must fail before preview.

### 13.4 State and quality tests

- `project:assets-ready` fails when asset quality passes but composite quality is pending or failed;
- changing one coupled member invalidates the family review;
- changing a cue invalidates its event proof without invalidating unrelated scenes;
- the three human gates and revision routes remain unchanged;
- installed plugin starter and cache workspace exercise v4 rather than a flat technical placeholder.

### 13.5 Forward test

After implementation and local validation, run a fresh-agent production task with only the normal user brief and the packaged Skill. The recommended acceptance story is `cao-chong-cheng-xiang`, because it naturally requires a subject supported by a boat and a registered water/shore environment.

The evaluation agent must not receive this diagnosis or the expected solution. Success means the Skill itself selects coupled masters, a supported-subject rig, registered boundaries, and composite proof before preview.

## 14. Acceptance criteria

The v4 optimization is complete only when:

- the two known defect families are rejected by deterministic validation before preview;
- a correct supported-subject group visibly places the subject within or on its support at all required proof times;
- a correct registered environment keeps semantic regions on the proper side of shared boundaries;
- visual and sound effects for one cue come from the same deterministic event record;
- quality reports distinguish asset success from composite success;
- style proof and preview use the actual production topology;
- the normal workflow still has exactly three human gates;
- source tests, TypeScript, bundle, doctor, fixture previews, and final technical checks pass;
- `plugin:sync` produces a packaged runtime that passes the same contract in an installed-cache smoke workspace;
- a fresh forward test succeeds without project-specific instructions or leaked diagnosis.

## 15. Implementation record

All six slices were completed on 2026-07-20:

1. v4 schemas and fixtures reject the flat v3 model and malformed relationship groups;
2. the recursive Remotion renderer applies camera, group, and child transforms once, with pattern-owned local stacking and fixed boundary clips;
3. image requests and manifests bind derivatives to registered source families and compound fingerprints;
4. the quality system independently gates file assets and rendered composites, including fingerprint-bound full frames, focused crops, debug overlays, and cue events;
5. storyboard planning, real-topology style proof, `project:assets-ready`, reporting, and the Skill now route the v4 workflow without adding a human gate;
6. source and packaged-plugin tests passed, the installed-cache fixture visibly kept a traveler behind the front gunwale and trees above the river boundary, and a diagnosis-blind fresh-agent `cao-chong-cheng-xiang` test selected both required composition patterns before stopping at the existing approval gate.

The original `ke-zhou-qiu-jian` project was deliberately not repaired as part of this implementation.

## 16. Implementation slices

Implementation should proceed in independently verifiable slices:

1. **Contract and failing fixtures** — add v4 schemas/types and broken fixtures that demonstrate current missing guarantees.
2. **Composition runtime** — implement recursive groups, local transforms, slots, masks, and deterministic cue composition.
3. **Source families and validation** — extend requests/manifests, geometry checks, alpha checks, and compound fingerprints.
4. **Composite proof and quality** — generate real proof frames/crops/debug overlays and enforce two-scope quality.
5. **Workflow and Skill** — update storyboard planning, style proof, assets-ready, reports, references, and concise top-level rules.
6. **Package and forward test** — sync the plugin, validate the installed cache, and run the clean `cao-chong-cheng-xiang` production test.

Do not begin by repairing the original test video. After slices 1–5 pass, `ke-zhou-qiu-jian` may be regenerated through the normal v4 path as a regression observation, not used as the implementation substrate.

## 17. Borrowed principles and boundaries

The design borrows these principles without importing either external renderer:

- from [HyperFrames](https://github.com/heygen-com/hyperframes): a composition contract separated from authoring workflow, keyframes as visible pose contracts, deterministic seek, focused proof snapshots, and one consolidated final check;
- from [`play-video`](https://github.com/gnipbao/play-video): one scene/event contract, seeded determinism, direct proof-time inspection, and an audiovisual event bus whose live and rendered paths share timestamps.

Remotion remains the renderer. Interactivity, virtual mouse input, p5 single-canvas authoring, and generic runtime adapters remain outside the paper-collage Skill.
