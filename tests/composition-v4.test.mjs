import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  CUE_ACTIONS,
  deriveCueEvents,
  hashCompositionValue,
  pointInPolygon,
  validateCompositionStructure,
} from '../scripts/composition-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const still = () => ({keyframes: [{at: 0, x: 0}, {at: 1, x: 0}]});
const fullTransform = () => ({x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0});
const asset = ({id, slot, role = 'prop', clip, semanticCoverage}) => ({
  id,
  kind: 'asset',
  assetRole: role,
  src: `projects/fixture/${id}.png`,
  z: 0,
  slot,
  registrationId: 'family-01',
  ...(clip ? {clip} : {}),
  ...(semanticCoverage ? {semanticCoverage} : {}),
  transform: fullTransform(),
  motion: still(),
});

const supportedGroup = () => ({
  id: 'boat-rig',
  kind: 'group',
  pattern: 'supported-subject',
  z: 2,
  coordinateSpace: {width: 100, height: 100},
  transform: fullTransform(),
  motion: still(),
  registration: {id: 'family-01', sourceMasterAssetId: 'boat-master', canvas: {width: 100, height: 100}, origin: 'top-left'},
  support: {
    subjectId: 'traveler',
    contactAnchor: {x: 0.5, y: 0.7},
    contactZone: [[0.3, 0.55], [0.75, 0.55], [0.78, 0.85], [0.28, 0.85]],
    occlusionZone: [[0.2, 0.58], [0.82, 0.58], [0.82, 0.9], [0.2, 0.9]],
  },
  children: [
    asset({id: 'boat-rear', slot: 'support-rear'}),
    asset({id: 'traveler', slot: 'subject', role: 'character'}),
    asset({id: 'boat-front', slot: 'support-front'}),
  ],
});

const registeredGroup = () => ({
  id: 'river-stack',
  kind: 'group',
  pattern: 'registered-environment',
  z: 0,
  coordinateSpace: {width: 100, height: 100},
  transform: fullTransform(),
  motion: still(),
  registration: {id: 'family-01', sourceMasterAssetId: 'river-master', canvas: {width: 100, height: 100}, origin: 'top-left'},
  boundaries: [{id: 'shoreline', normalizedY: 0.55, upperSemantic: 'land', lowerSemantic: 'water'}],
  children: [
    asset({id: 'bank', slot: 'upper-band', role: 'environment', clip: {boundaryId: 'shoreline', side: 'upper'}, semanticCoverage: ['bank', 'trees']}),
    asset({id: 'water', slot: 'lower-band', role: 'environment', clip: {boundaryId: 'shoreline', side: 'lower'}, semanticCoverage: ['water']}),
  ],
});

const validate = (node, proofTimes = [{id: 'establish', at: 0.08}, {id: 'action', at: 0.5}, {id: 'final', at: 0.9}]) => validateCompositionStructure({
  composition: {coordinateSpace: {width: 100, height: 100}, nodes: [node]},
  video: {width: 100, height: 100},
  proofTimes,
});

test('v4 supported subjects require contact, front occlusion and one carrier motion', () => {
  assert.deepEqual(validate(supportedGroup()).issues, []);
  const missingFront = supportedGroup();
  missingFront.children = missingFront.children.filter(({slot}) => slot !== 'support-front');
  assert.ok(validate(missingFront).issues.some(({code}) => code === 'composition-support-slot'));

  const detached = supportedGroup();
  detached.support.contactAnchor = {x: 0.95, y: 0.1};
  assert.ok(validate(detached).issues.some(({code}) => code === 'composition-support-contact'));

  const duplicated = supportedGroup();
  duplicated.motion = {keyframes: [{at: 0, x: 0}, {at: 1, x: 0.1}]};
  duplicated.children[1].motion = structuredClone(duplicated.motion);
  assert.ok(validate(duplicated).issues.some(({code}) => code === 'composition-duplicated-carrier-motion'));
});

test('v4 registered environments enforce a shared canvas, boundary and exclusive semantics', () => {
  assert.deepEqual(validate(registeredGroup()).issues, []);
  const shifted = registeredGroup();
  shifted.children[1].transform.x = 0.02;
  assert.ok(validate(shifted).issues.some(({code}) => code === 'composition-registration-transform'));
  const duplicated = registeredGroup();
  duplicated.children[1].semanticCoverage.push('trees');
  assert.ok(validate(duplicated).issues.some(({code}) => code === 'composition-semantic-duplicate'));
});

test('geometry, cue catalog and fingerprints remain deterministic', () => {
  assert.equal(pointInPolygon([0.5, 0.5], [[0, 0], [1, 0], [1, 1], [0, 1]]), true);
  assert.equal(pointInPolygon([1.5, 0.5], [[0, 0], [1, 0], [1, 1], [0, 1]]), false);
  assert.ok(CUE_ACTIONS.includes('drop-impact'));
  assert.ok(CUE_ACTIONS.includes('carve'));
  const first = hashCompositionValue(supportedGroup());
  const changed = supportedGroup();
  changed.support.contactAnchor.x = 0.51;
  assert.notEqual(first, hashCompositionValue(changed));
  assert.equal(first, hashCompositionValue(supportedGroup()));

  const events = deriveCueEvents({
    scene: {id: 'scene', durationInFrames: 100, cues: [{id: 'impact', beatId: 'fall', at: 0.5, targetId: 'sword', action: 'drop-impact', proofTimeId: 'proof-impact', sound: {src: 'impact.wav'}}]},
    sceneFrom: 20,
    fps: 20,
  });
  assert.deepEqual(events[0], {
    sceneId: 'scene',
    cueId: 'impact',
    beatId: 'fall',
    targetId: 'sword',
    action: 'drop-impact',
    localFrame: 50,
    absoluteFrame: 70,
    seconds: 3.5,
    proofTimeId: 'proof-impact',
    sound: 'impact.wav',
  });
});

test('bundled render fixture exercises supported-subject and registered-environment together', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'composition-v4', 'project.json'), 'utf8'));
  const scene = fixture.scenes[0];
  const result = validateCompositionStructure({
    composition: scene.composition,
    video: fixture.video,
    proofTimes: scene.motion.proofTimes,
  });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.groups.map(({node}) => node.pattern).sort(), ['registered-environment', 'supported-subject']);
});
