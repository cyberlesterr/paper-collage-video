import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  ASPECT_RATIOS,
  confirmIntake,
  intakeDecisionFingerprint,
  validateIntake,
} from '../scripts/intake-lib.mjs';
import {
  assertPlanningScenariosReady,
  assertStoryboardMatchesScenario,
  buildCreativePlanFromScenario,
  buildPlanningScenarios,
  deriveProfilePromise,
  scenarioDecisionFor,
} from '../scripts/planning-scenario-lib.mjs';
import {validateCreativePlan} from '../scripts/creative-plan-lib.mjs';
import {
  summarizeProfileFulfillment,
} from '../scripts/motion-treatment-lib.mjs';
import {
  loadStyleCatalog,
  materializeStyleProfile,
  styleCatalogDecision,
} from '../scripts/style-catalog-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = '2026-07-25T00:00:00.000Z';

const makeScene = ({
  profile,
  index,
  stateFamily = null,
  layered = false,
  parallax = false,
  ambient = false,
  localMotionCount = 1,
}) => ({
  id: `${profile}-scene-${String(index + 1).padStart(2, '0')}`,
  label: `第 ${index + 1} 幕`,
  beat: `共同故事节拍 ${index + 1}`,
  characterActions: ['角色执行清晰可见的叙事动作'],
  stateFamilies: stateFamily ? [stateFamily] : [],
  layers: {
    rear: layered ? ['远景森林'] : [],
    mid: ['角色与跑道'],
    front: layered ? ['近处草丛'] : [],
    near: profile === 'full-depth' ? ['掠过镜头的叶片'] : [],
  },
  sourcePackages: [
    {
      id: `${profile}-source-${index + 1}`,
      strategy: layered ? 'registered-layer-sheet' : 'single-background',
      providerCalls: 1,
      localDerivatives: layered ? 3 : 0,
      avoidedCalls: layered ? 3 : 0,
    },
  ],
  parallax,
  ambientElements: ambient ? ['风中的叶片'] : [],
  localMotionTargets: Array.from(
    {length: localMotionCount},
    (_, motionIndex) => ({
      targetId: `target-${index + 1}-${motionIndex + 1}`,
      preset: motionIndex === 0 ? 'translate' : 'breathe',
    }),
  ),
});

const makeOption = ({
  id,
  storyScope,
  sceneCount,
  stateFamilies,
  layeredScenes,
  parallaxScenes,
  ambientScenes,
  localMotionCount,
  durationSeconds,
}) => {
  const scenes = Array.from({length: sceneCount}, (_, index) =>
    makeScene({
      profile: id,
      index,
      stateFamily: stateFamilies[index] ?? null,
      layered: index < layeredScenes,
      parallax: index < parallaxScenes,
      ambient: index < ambientScenes,
      localMotionCount,
    }),
  );
  const semanticScene = scenes.at(-1);
  const apologyFamily = {
    id: 'hare-apology',
    necessity: 'required',
    states: ['upright', 'apologizing'],
  };
  semanticScene.stateFamilies.push(apologyFamily);
  const familyCount = new Set(
    scenes.flatMap(({stateFamilies: families}) =>
      families.map(({id: familyId}) => familyId),
    ),
  ).size;
  const expected = 1 + sceneCount + familyCount;
  return {
    id,
    storyScope,
    durationSeconds,
    sceneCount,
    estimatedNarrationSeconds: durationSeconds - 6,
    rationale: `${storyScope} 范围与 ${id} 制作深度相匹配`,
    scenes,
    semanticActionCoverage: [{
      actionId: 'hare-apologizes',
      sceneId: semanticScene.id,
      targetId: 'hare',
      execution: 'registered-state',
      stateRef: {
        poseFamilyId: apologyFamily.id,
        stateId: 'apologizing',
      },
      visibleResult: '兔子低头并将前爪收在胸前，明确呈现道歉姿态。',
    }],
    proposedImageAttemptLimit: expected + 2,
    providerRecommendation: {
      text: 'current-host-model',
      image: 'user-confirmed-image-provider',
      voice: 'user-confirmed-voice-provider',
    },
    costNote: '按预计图片调用数计；具体金额以确认时 provider 报价为准。',
    factsAndRightsRisks: [],
    finalEffect: `${id} 的可见成片承诺`,
  };
};

const stateFamilies = (count, necessity, statesPerFamily) =>
  Array.from({length: count}, (_, index) => ({
    id: `${necessity}-family-${index + 1}`,
    necessity,
    states: Array.from(
      {length: statesPerFamily},
      (_, stateIndex) => `state-${stateIndex + 1}`,
    ),
  }));

const makeScenarioInput = () => ({
  requested: {durationSeconds: null, sceneCount: null},
  commonStory: {
    logline: '兔子轻敌睡着，乌龟坚持前进并赢得比赛。',
    audience: '6–10 岁儿童与家庭观众',
    theme: '稳定坚持胜过骄傲轻敌',
    ending: '兔子承认错误，乌龟与伙伴一起庆祝。',
    beats: ['提出比赛', '兔子领先并休息', '乌龟持续前进', '乌龟获胜'],
    semanticActions: [{
      id: 'hare-apologizes',
      summary: '结尾必须看见兔子以明确姿态向乌龟道歉。',
      requiredExecution: 'registered-state',
    }],
  },
  options: [
    makeOption({
      id: 'draft',
      storyScope: 'concise',
      sceneCount: 4,
      stateFamilies: [],
      layeredScenes: 0,
      parallaxScenes: 0,
      ambientScenes: 0,
      localMotionCount: 1,
      durationSeconds: 32,
    }),
    makeOption({
      id: 'balanced',
      storyScope: 'standard',
      sceneCount: 6,
      stateFamilies: [
        ...stateFamilies(2, 'required', 3),
      ],
      layeredScenes: 3,
      parallaxScenes: 2,
      ambientScenes: 2,
      localMotionCount: 2,
      durationSeconds: 54,
    }),
    makeOption({
      id: 'full-depth',
      storyScope: 'expanded',
      sceneCount: 8,
      stateFamilies: [
        ...stateFamilies(4, 'required', 4),
        ...stateFamilies(3, 'enhancement', 4),
      ],
      layeredScenes: 8,
      parallaxScenes: 6,
      ambientScenes: 4,
      localMotionCount: 3,
      durationSeconds: 82,
    }),
  ],
});

test('built-in style catalog is dynamic and contains fingerprinted cards for one canonical subject', async () => {
  const catalog = await loadStyleCatalog({root: ROOT});
  assert.ok(catalog.styles.length >= 1);
  assert.match(catalog.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(
    new Set(catalog.styles.map(({image}) => image)).size,
    catalog.styles.length,
  );
  assert.equal(
    new Set(catalog.styles.map(({profileFingerprint}) => profileFingerprint))
      .size,
    catalog.styles.length,
  );
  assert.ok(
    catalog.styles.every(({profile}) =>
      ['paper-story', 'clean-video'].includes(profile.motion.transitionSet),
    ),
  );
  const comicStyleIds = [
    'korean-cinematic-comic',
    'japanese-animation-comic',
    'hong-kong-action-comic',
    'american-superhero-comic',
  ];
  const comicStyles = comicStyleIds.map((styleId) => {
    const style = catalog.styles.find(({id}) => id === styleId);
    assert.ok(style, `missing bundled comic style ${styleId}`);
    return style;
  });
  for (const {profile} of comicStyles) {
    assert.equal(profile.motion.transitionSet, 'clean-video');
    assert.equal(profile.render.theme.surface.texture, null);
    assert.equal(profile.render.theme.surface.subjectEdge.mode, 'none');
    assert.equal(profile.render.theme.surface.subjectShadow.mode, 'none');
    assert.ok(profile.motion.visualSfx.maxPerScene <= 2);
    assert.ok(
      profile.generation.negativeDirectives.some((directive) =>
        directive.includes('long-scroll comic layouts'),
      ),
    );
    assert.ok(
      profile.generation.negativeDirectives.some((directive) =>
        directive.includes('Speech balloons'),
      ),
    );
  }
  const dimensions = new Set();
  for (const style of catalog.styles) {
    assert.equal((await fs.stat(style.absolutePath)).isFile(), true);
    const metadata = await sharp(style.absolutePath).metadata();
    assert.equal(metadata.format, 'png');
    assert.ok(metadata.width >= 1200);
    assert.ok(metadata.height >= 675);
    assert.ok(Math.abs(metadata.width / metadata.height - 16 / 9) < 0.01);
    dimensions.add(`${metadata.width}x${metadata.height}`);
  }
  assert.equal(dimensions.size, 1);
  const provenance = JSON.parse(
    await fs.readFile(
      path.join(ROOT, 'public', 'style-catalog', 'generation-provenance.json'),
      'utf8',
    ),
  );
  assert.equal(provenance.generator, 'Codex built-in image_gen');
  assert.equal(provenance.generationCount, provenance.images.length);
  assert.deepEqual(
    provenance.images.map(({id}) => id),
    catalog.styles.map(({id}) => id),
  );
  for (const image of provenance.images) {
    const source = await fs.readFile(
      path.join(ROOT, 'public', 'style-catalog', image.file),
    );
    assert.equal(
      createHash('sha256').update(source).digest('hex'),
      image.sha256,
    );
  }
  const styleProfileSchema = JSON.parse(
    await fs.readFile(
      path.join(ROOT, 'schemas', 'style-profile.schema.json'),
      'utf8',
    ),
  );
  const ajv = new Ajv2020({
    strict: false,
    formats: {'date-time': true},
  });
  ajv.addSchema(styleProfileSchema);
  const validator = ajv.compile(
    JSON.parse(
      await fs.readFile(
        path.join(ROOT, 'schemas', 'style-catalog.schema.json'),
        'utf8',
      ),
    ),
  );
  const persisted = JSON.parse(
    await fs.readFile(
      path.join(ROOT, 'public', 'style-catalog', 'catalog.json'),
      'utf8',
    ),
  );
  assert.equal(validator(persisted), true, JSON.stringify(validator.errors));
  const executable = materializeStyleProfile(
    catalog,
    'hand-drawn-cutout-explainer',
  );
  assert.equal(
    executable.render.theme.surface.subjectShadow.blurPx,
    7,
  );
  assert.ok(
    executable.quality.requiredAssetChecks.includes(
      'style-profile-conformant',
    ),
  );
});

test('intake separates runtime cards from hash-equivalent presentation cards and rejects drift', async () => {
  const presentationCatalog = await loadStyleCatalog({root: ROOT});
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'paper-collage-style-presentation-'),
  );
  try {
    const runtimeDirectory = path.join(
      directory,
      'public',
      'style-catalog',
    );
    await fs.cp(
      path.join(ROOT, 'public', 'style-catalog'),
      runtimeDirectory,
      {recursive: true},
    );
    const runtimeCatalog = await loadStyleCatalog({root: directory});
    const decision = styleCatalogDecision(runtimeCatalog, {
      presentationCatalog,
    });
    assert.equal(
      decision.fingerprint,
      decision.presentationFingerprint,
    );
    assert.equal(decision.styles.length, runtimeCatalog.styles.length);
    for (const style of decision.styles) {
      assert.ok(style.runtimePath.startsWith(directory));
      assert.ok(style.presentationPath.startsWith(ROOT));
      assert.notEqual(style.runtimePath, style.presentationPath);
      assert.match(style.imageSha256, /^[a-f0-9]{64}$/);
    }

    await fs.appendFile(
      path.join(runtimeDirectory, runtimeCatalog.styles[0].image.split('/').at(-1)),
      'runtime-drift',
    );
    const driftedRuntimeCatalog = await loadStyleCatalog({root: directory});
    assert.throws(
      () => styleCatalogDecision(driftedRuntimeCatalog, {
        presentationCatalog,
      }),
      /展示风格目录与工作区风格目录的完整指纹不一致/,
    );
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('a new valid catalog profile becomes selectable without changing a style id enum', async () => {
  const source = await loadStyleCatalog({root: ROOT});
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'paper-collage-style-catalog-'),
  );
  try {
    const catalogDirectory = path.join(directory, 'public', 'style-catalog');
    await fs.mkdir(catalogDirectory, {recursive: true});
    for (const style of source.styles) {
      await fs.mkdir(
        path.dirname(path.join(directory, 'public', style.image)),
        {recursive: true},
      );
      await fs.copyFile(
        style.absolutePath,
        path.join(directory, 'public', style.image),
      );
    }
    const addedImage = 'style-catalog/dynamic-test-style.png';
    await fs.copyFile(
      source.styles[0].absolutePath,
      path.join(directory, 'public', addedImage),
    );
    const catalog = JSON.parse(
      await fs.readFile(source.catalogFile, 'utf8'),
    );
    catalog.styles.push({
      ...structuredClone(catalog.styles[0]),
      id: 'dynamic-test-style',
      label: '动态测试风格',
      image: addedImage,
    });
    await fs.writeFile(
      path.join(catalogDirectory, 'catalog.json'),
      `${JSON.stringify(catalog, null, 2)}\n`,
      'utf8',
    );
    const loaded = await loadStyleCatalog({root: directory});
    assert.equal(loaded.styles.length, source.styles.length + 1);
    assert.equal(
      confirmIntake({
        selection: {
          aspectRatio: '16:9',
          visualStylePreset: 'dynamic-test-style',
          parallaxPreference: 'minimal',
        },
        catalog: loaded,
      }).visualStylePreset,
      'dynamic-test-style',
    );
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('intake locks the two supported aspect ratios and separates parallax from visual style', async () => {
  const catalog = await loadStyleCatalog({root: ROOT});
  const intake = confirmIntake({
    selection: {
      aspectRatio: '9:16',
      visualStylePreset: 'childrens-picture-book-paper',
      parallaxPreference: 'auto',
      note: '用户通过初始 Ask Question 确认',
    },
    catalog,
    at,
  });
  assert.deepEqual(validateIntake(intake), []);
  assert.deepEqual(ASPECT_RATIOS[intake.aspectRatio], {
    width: 1080,
    height: 1920,
    label: '竖屏 9:16',
  });
  assert.equal(intake.visualStylePreset.includes('parallax'), false);
  assert.equal(
    intake.styleProfileFingerprint,
    catalog.styles.find(
      ({id}) => id === intake.visualStylePreset,
    ).profileFingerprint,
  );
  assert.match(intakeDecisionFingerprint(intake), /^[a-f0-9]{64}$/);
});

test('three scenarios bind story scope, exact calls, caps, and quality floors before provider use', async () => {
  const catalog = await loadStyleCatalog({root: ROOT});
  const intake = confirmIntake({
    selection: {
      aspectRatio: '16:9',
      visualStylePreset: 'hand-drawn-cutout-explainer',
      parallaxPreference: 'auto',
    },
    catalog,
    at,
  });
  const scenarios = buildPlanningScenarios({
    slug: 'gui-tu-sai-pao',
    intake,
    input: makeScenarioInput(),
    at,
  });
  assert.doesNotThrow(() =>
    assertPlanningScenariosReady(scenarios, {
      slug: 'gui-tu-sai-pao',
      intake,
    }),
  );
  assert.deepEqual(
    scenarios.options.map(({id, storyScope}) => [id, storyScope]),
    [
      ['draft', 'concise'],
      ['balanced', 'standard'],
      ['full-depth', 'expanded'],
    ],
  );
  assert.deepEqual(
    scenarios.options.map(({providerEstimate}) => [
      providerEstimate.expectedImageCalls,
      providerEstimate.proposedImageAttemptLimit,
      providerEstimate.hardCeiling,
    ]),
    [
      [6, 8, 15],
      [10, 12, 38],
      [17, 19, 97],
    ],
  );
  assert.ok(scenarios.options.every(({plannedFulfillment}) => plannedFulfillment.passed));
  assert.deepEqual(scenarios.styleProfileBinding, {
    id: intake.visualStylePreset,
    catalogVersion: intake.styleCatalogVersion,
    profileFingerprint: intake.styleProfileFingerprint,
  });
  const validator = new Ajv2020({
    strict: false,
    formats: {'date-time': true},
  }).compile(
    JSON.parse(
      await fs.readFile(
        path.join(ROOT, 'schemas', 'planning-scenarios.schema.json'),
        'utf8',
      ),
    ),
  );
  assert.equal(validator(scenarios), true, JSON.stringify(validator.errors));

  const plan = buildCreativePlanFromScenario({
    slug: 'gui-tu-sai-pao',
    scenarios,
    optionId: 'balanced',
    at,
  });
  assert.deepEqual(validateCreativePlan(plan, {slug: 'gui-tu-sai-pao'}), []);
  assert.equal(plan.storyScope, 'standard');
  assert.equal(plan.scenarioBinding.expectedProviderImageCalls, 10);
  assert.deepEqual(plan.motionBudget, {
    maxPoseSheetCalls: 3,
    maxStatesPerSheet: 4,
    maxContinuousTargets: 24,
  });
  assert.deepEqual(
    scenarioDecisionFor(scenarios, 'balanced'),
    {
      scenarioSetFingerprint: scenarios.fingerprint,
      optionId: 'balanced',
      optionFingerprint: scenarios.options[1].fingerprint,
      storyScope: 'standard',
      durationSeconds: 54,
      sceneCount: 6,
      expectedProviderImageCalls: 10,
      providerRootPlanFingerprint:
        plan.scenarioBinding.providerRootPlan.fingerprint,
      proposedImageAttemptLimit: 12,
      profileHardCeiling: 38,
    },
  );
  const balanced = scenarios.options[1];
  const balancedFamilies = balanced.scenes.flatMap(({stateFamilies}) => stateFamilies);
  const balancedSources = balanced.scenes
    .flatMap(({sourcePackages}) => sourcePackages)
    .filter(({strategy}) => strategy !== 'single-background');
  const directingSummary = {
    poseSheetPlans: balancedFamilies.map((family) => ({
      poseFamilyId: family.id,
      necessity: family.necessity,
      stateIds: family.states,
    })),
    generationBudget: {
      expectedProviderImageCalls:
        balancedFamilies.length +
        balancedSources.reduce(
          (total, source) => total + source.providerCalls,
          0,
        ),
      sourcePackagePlans: balancedSources.map((source) => ({
        id: source.id,
        sourceStrategy: source.strategy,
        providerImageCalls: source.providerCalls,
        localDerivatives: source.localDerivatives,
        avoidedCalls: source.avoidedCalls,
      })),
    },
  };
  assert.deepEqual(
    assertStoryboardMatchesScenario(balanced, directingSummary),
    {
      poseFamilyCount: 3,
      sourcePackageCount: 3,
      structuralProviderImageCalls: 6,
    },
  );
  assert.throws(
    () =>
      assertStoryboardMatchesScenario(balanced, {
        ...directingSummary,
        poseSheetPlans: directingSummary.poseSheetPlans.slice(0, 1),
      }),
    /姿态母版家族/,
  );
  const missingApology = structuredClone(directingSummary);
  missingApology.poseSheetPlans = missingApology.poseSheetPlans.map((family) =>
    family.poseFamilyId === 'hare-apology'
      ? {...family, stateIds: ['upright']}
      : family,
  );
  assert.throws(
    () => assertStoryboardMatchesScenario(balanced, missingApology),
    /姿态母版家族|关键动作/,
  );
});

test('scenario source packages use the same exact costs as storyboard planning', async () => {
  const catalog = await loadStyleCatalog({root: ROOT});
  const intake = confirmIntake({
    selection: {
      aspectRatio: '16:9',
      visualStylePreset: 'hand-drawn-cutout-explainer',
      parallaxPreference: 'auto',
    },
    catalog,
    at,
  });
  const input = makeScenarioInput();
  const source = input.options[2].scenes[0].sourcePackages[0];
  source.strategy = 'context-preserving-layer-edits';
  source.providerCalls = 1;
  source.localDerivatives = 3;
  source.avoidedCalls = 0;
  assert.throws(
    () =>
      buildPlanningScenarios({
        slug: 'source-cost-drift',
        intake,
        input,
        at,
      }),
    /providerCalls.*context-preserving-layer-edits/,
  );
});

test('a selected one-take scenario raises motion capacity to its exact approved demand', () => {
  const scenarios = {
    fingerprint: 'a'.repeat(64),
    requested: {durationSeconds: null, sceneCount: 1},
    options: [
      {
        id: 'full-depth',
        storyScope: 'expanded',
        durationSeconds: 92,
        sceneCount: 1,
        estimatedNarrationSeconds: 82,
        rationale: 'one continuous journey with several independently animated encounters',
        fingerprint: 'b'.repeat(64),
        profilePromise: {
          minRequiredStateFamilies: 1,
          minEnhancementStateFamilies: 1,
          minTotalStates: 8,
          minLocalMotionTargets: 3,
          minLayeredScenes: 1,
          minParallaxScenes: 1,
          minAmbientScenes: 1,
        },
        providerEstimate: {
          expectedImageCalls: 7,
          proposedImageAttemptLimit: 11,
        },
        scenes: [
          {
            id: 'scene-01',
            stateFamilies: [
              {
                id: 'lead-depth-cycle',
                necessity: 'required',
                states: Array.from(
                  {length: 12},
                  (_, index) => `lead-${index}`,
                ),
              },
              ...Array.from({length: 5}, (_, familyIndex) => ({
                id: `encounter-${familyIndex}`,
                necessity: familyIndex === 4 ? 'enhancement' : 'required',
                states: Array.from(
                  {length: 4},
                  (_, stateIndex) => `state-${stateIndex}`,
                ),
              })),
            ],
            localMotionTargets: Array.from({length: 8}, (_, index) => ({
              targetId: `target-${index}`,
              preset: 'translate',
            })),
          },
        ],
      },
    ],
  };
  const plan = buildCreativePlanFromScenario({
    slug: 'one-take-journey',
    scenarios,
    optionId: 'full-depth',
    at,
  });
  assert.deepEqual(plan.motionBudget, {
    maxPoseSheetCalls: 6,
    maxStatesPerSheet: 12,
    maxContinuousTargets: 8,
  });
  assert.deepEqual(validateCreativePlan(plan, {slug: 'one-take-journey'}), []);
  assert.equal(plan.assetBudget.maxGeneratedImages, 14);
  assert.equal(plan.scenarioBinding.expectedProviderImageCalls, 7);
  assert.equal(plan.scenarioBinding.providerRootPlan.roots.length, 7);
});

test('scenario rejects a key semantic action that is counted but not visibly executed', async () => {
  const catalog = await loadStyleCatalog({root: ROOT});
  const intake = confirmIntake({
    selection: {
      aspectRatio: '16:9',
      visualStylePreset: 'hand-drawn-cutout-explainer',
      parallaxPreference: 'auto',
    },
    catalog,
    at,
  });
  const input = makeScenarioInput();
  for (const option of input.options) {
    option.semanticActionCoverage[0].stateRef.stateId = 'bowing';
  }
  assert.throws(
    () => buildPlanningScenarios({
      slug: 'semantic-action-gap',
      intake,
      input,
      at,
    }),
    /poseFamilyId\/stateId/,
  );
});

test('profile fulfillment turns selected production depth into a minimum, not only a ceiling', () => {
  const promise = deriveProfilePromise({
    productionProfile: 'full-depth',
    sceneCount: 2,
    parallaxPreference: 'auto',
  });
  const result = summarizeProfileFulfillment(
    [
      {
        compositionPlan: {layerStacks: [], patterns: []},
        beats: [{treatments: []}],
      },
      {
        compositionPlan: {layerStacks: [], patterns: []},
        beats: [{treatments: []}],
      },
    ],
    {
      requiredStateFamilies: 0,
      enhancementStateFamilies: 0,
      totalStates: 0,
      localMotionTargets: 0,
    },
    promise,
  );
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.startsWith('layeredScenes:')));
  assert.ok(result.issues.some((issue) => issue.startsWith('localMotionTargets:')));
});
