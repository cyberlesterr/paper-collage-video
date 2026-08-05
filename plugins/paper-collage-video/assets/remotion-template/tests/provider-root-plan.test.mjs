import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessProviderRootRealization,
  assertScenarioRootRequest,
  buildProviderRootPlan,
} from '../scripts/provider-root-plan-lib.mjs';

const option = {
  id: 'full-depth',
  scenes: [
    {
      id: 'scene-01',
      sourcePackages: [
        {
          id: 'city-background',
          strategy: 'single-background',
          providerCalls: 1,
        },
      ],
      stateFamilies: [
        {id: 'traveler-cycle', states: ['idle', 'walk']},
      ],
    },
    {
      id: 'scene-02',
      sourcePackages: [
        {
          id: 'water-clock',
          strategy: 'canonical-frame-with-content-sheet',
          stateFamilyId: 'water-levels',
          providerCalls: 3,
        },
      ],
      stateFamilies: [
        {id: 'water-levels', states: ['high', 'low']},
      ],
    },
  ],
};

const plan = buildProviderRootPlan(option);
const scenarioBinding = {providerRootPlan: plan};

const providerRecord = (assetId, rootId, extra = {}) => {
  const root = plan.roots.find(({id}) => id === rootId);
  const request = {
    capability: 'image',
    scenarioRootBinding: {
      schemaVersion: 1,
      planFingerprint: plan.fingerprint,
      rootId,
    },
    compositionBinding: {
      sceneId: root.sceneId ?? 'style-proof',
      derivation: {method: 'provider-generation'},
    },
  };
  if (root.kind === 'style-proof') {
    request.quality = {kind: 'style-sample'};
  } else if (root.kind === 'pose-sheet') {
    request.stateSheetBinding = {poseFamilyId: root.poseFamilyId};
  } else if (root.sourceStrategy === 'canonical-frame-with-content-sheet') {
    request.containerPackageBinding = {
      sourcePackageId: root.sourcePackageId,
      packageRole: root.role,
    };
  }
  return {
    assetId,
    recoveredFromRejectedAttempt: false,
    request,
    lifecycle: {status: 'active'},
    ...extra,
  };
};

test('scenario compiles every approved provider call into one exact root', () => {
  assert.deepEqual(
    plan.roots.map(({id}) => id),
    [
      'style-proof:style-sample',
      'source-package:city-background:background',
      'source-package:water-clock:clean-plate',
      'source-package:water-clock:canonical-frame',
      'source-package:water-clock:content-state-sheet',
      'pose-sheet:traveler-cycle',
    ],
  );
});

test('provider requests must bind the exact approved root and role', () => {
  const root = assertScenarioRootRequest({
    scenarioBinding,
    request: {
      capability: 'image',
      quality: {kind: 'mechanism'},
      compositionBinding: {
        sceneId: 'scene-02',
        derivation: {method: 'provider-generation'},
      },
      containerPackageBinding: {
        sourcePackageId: 'water-clock',
        packageRole: 'clean-plate',
      },
      scenarioRootBinding: {
        schemaVersion: 1,
        planFingerprint: plan.fingerprint,
        rootId: 'source-package:water-clock:clean-plate',
      },
    },
  });
  assert.equal(root.role, 'clean-plate');
  assert.throws(
    () =>
      assertScenarioRootRequest({
        scenarioBinding,
        request: {
          capability: 'image',
          compositionBinding: {
            sceneId: 'scene-02',
            derivation: {method: 'provider-generation'},
          },
        },
      }),
    /必须绑定当前 providerRootPlan/,
  );
  assert.throws(
    () =>
      assertScenarioRootRequest({
        scenarioBinding,
        request: {
          capability: 'image',
          compositionBinding: {
            sceneId: 'scene-02',
            derivation: {method: 'manual-import'},
          },
          scenarioRootBinding: {
            schemaVersion: 1,
            planFingerprint: plan.fingerprint,
            rootId: 'source-package:water-clock:clean-plate',
          },
        },
      }),
    /只有 provider-generation\/provider-edit/,
  );
});

test('assets-ready realization rejects a 2-of-6 structural substitute', () => {
  const manifest = {
    assets: [
      providerRecord('style', 'style-proof:style-sample'),
      providerRecord('traveler', 'pose-sheet:traveler-cycle'),
      {
        ...providerRecord(
          'manual-water-clock',
          'source-package:water-clock:clean-plate',
        ),
        request: {
          compositionBinding: {derivation: {method: 'manual-import'}},
        },
      },
    ],
  };
  const result = assessProviderRootRealization({scenarioBinding, manifest});
  assert.equal(result.passed, false);
  assert.equal(result.expected, 6);
  assert.equal(result.realized, 2);
  assert.deepEqual(result.missingRootIds, [
    'source-package:city-background:background',
    'source-package:water-clock:clean-plate',
    'source-package:water-clock:canonical-frame',
    'source-package:water-clock:content-state-sheet',
  ]);
});

test('formal rejected-output recovery may realize its approved root', () => {
  const records = plan.roots.map(({id}, index) =>
    providerRecord(`root-${index}`, id),
  );
  records[2] = providerRecord('recovered-root', plan.roots[2].id, {
    recoveredFromRejectedAttempt: true,
    providerObservation: {
      sourceAttempt: {status: 'rejected', quotaConsumed: true},
    },
    lifecycle: {status: 'recovery-source'},
  });
  const result = assessProviderRootRealization({
    scenarioBinding,
    manifest: {assets: records},
  });
  assert.equal(result.passed, true);
  assert.equal(result.realized, 6);
});
