#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveWorkspacePath} from './provider-lib.mjs';
import {
  loadProject,
  readJson,
  ROOT,
  writeJsonTransaction,
} from './project-lib.mjs';
import {
  assertPlanningScenariosReady,
  assertStoryboardMatchesScenario,
} from './planning-scenario-lib.mjs';
import {
  loadProduction,
  recordMotionLanguageCard,
} from './production-state.mjs';
import {
  compileStoryboardDirecting,
  storyboardFileFor,
  summarizeStoryboard,
  validateStoryboard,
} from './storyboard-lib.mjs';
import {materializeSceneTransitionRecipes} from '../src/sceneTimeline.mjs';
import {motionLanguageCard} from './motion-contract-lib.mjs';
import {soundEffectArtifactsFor} from './sound-effect-lib.mjs';
import {findStoryboardTodoMarkers} from './storyboard-scaffold-lib.mjs';
import {sourcePackageDecisionFor} from './layer-source-plan-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：project:storyboard -- <slug> --input=<storyboard.json> [--json]';
printCliHelp(args, USAGE);
const json = args.includes('--json');
const slug = args.find((arg) => !arg.startsWith('--'));
const input = args.find((arg) => arg.startsWith('--input='))?.slice('--input='.length);

// The concept gate compares sourcePackageDecision against an exact projection
// of this budget. Printing the canonical object is the only way an author can
// supply it without reverse-engineering which keys are compared.
const printCanonicalJson = ({slug, summary, storyboard}) => {
  console.log(
    JSON.stringify(
      {
        slug,
        sceneCount: summary.sceneCount,
        directingSummary: storyboard.directingSummary,
        sourcePackageDecision: sourcePackageDecisionFor(
          storyboard.directingSummary,
        ),
      },
      null,
      2,
    ),
  );
};

const printStoryboard = ({slug, summary, storyboard, paths, soundEffects, input}) => {
  const {generationBudget} = storyboard.directingSummary;
  console.log(`✓ 故事板已锁定：${summary.sceneCount} 个镜头`);
  console.log(
    `  motion contract: ${storyboard.motionContract.direction.summary} · approval ${storyboard.motionContract.approvalFingerprint}`,
  );
  console.log(`  motion card: ${paths.motionLanguageCardFile}`);
  for (const scene of summary.scenes) {
    console.log(`  ${scene.id}: ${scene.blueprint} · ${scene.treatmentCount} treatments · risk ${scene.riskScore} · ${scene.proofCount} proofs`);
  }
  console.log(`  motion budget: ${summary.directing.estimatedPoseSheetCalls} pose-sheet calls · ${summary.directing.avoidedIsolatedStateCalls} isolated calls avoided`);
  console.log(
    `  source packages: ${generationBudget.requiredProviderImageCalls} required provider calls · ${generationBudget.localDerivatives} local derivatives · ${generationBudget.avoidedCalls} calls avoided · hard ceiling ${generationBudget.hardCeiling}`,
  );
  console.log(
    `  sound effects: ${soundEffects.plan.requiredSoundEffectCount} unique provider assets · ${soundEffects.requests.length} active requests · ${soundEffects.removedRequests.length} stale requests removed`,
  );
  console.log(
    `  下一步：project:confirm-concept -- ${slug} --scaffold 生成完整 selection；或 project:storyboard -- ${slug} --input=${input} --json 单独取 canonical sourcePackageDecision。`,
  );
};

try {
  if (!slug || !input) throw new Error(USAGE);
  const {state} = await loadProduction(slug);
  if (!['capability-review', 'brief', 'concept-review'].includes(state.stage)) {
    throw new Error(`project:storyboard 只能在 capability-review、brief 或 concept-review 阶段运行；当前为 ${state.stage}。`);
  }
  const {project, paths} = await loadProject(slug);
  if (project.plan?.status !== 'resolved') throw new Error('请先运行 project:plan，再编排故事板。');
  const supplied = JSON.parse(
    await fs.readFile(resolveWorkspacePath(input, 'storyboard 输入路径'), 'utf8'),
  );
  const todoMarkers = findStoryboardTodoMarkers(supplied);
  if (todoMarkers.length > 0) {
    throw new Error(
      `storyboard 输入仍含 ${todoMarkers.length} 处未完成的脚手架标记，先补齐再编译：\n` +
        todoMarkers.map((marker) => `- ${marker}`).join('\n'),
    );
  }
  const authored = {
    ...supplied,
    $schema: '../../schemas/storyboard.schema.json',
    schemaVersion: 12,
    slug,
    status: 'ready',
    sceneTransitions: materializeSceneTransitionRecipes(
      supplied.sceneTransitions,
      project.styleProfile?.motion?.transitionSet,
    ),
    updatedAt: new Date().toISOString(),
  };
  const storyboard = compileStoryboardDirecting(authored, {
    plan: project.plan,
    styleProfile: project.styleProfile,
  });
  const issues = validateStoryboard(storyboard, {
    slug,
    plan: project.plan,
    styleProfile: project.styleProfile,
  });
  if (issues.length > 0) {
    throw new Error(issues.map(({location, message}) => `${location}: ${message}`).join('\n'));
  }
  // Approved-but-unreferenced states and source-package drift used to surface
  // two gates later, at concept confirmation, after the whole storyboard was
  // written. Checking here reports it while the author is still editing.
  if (project.plan.scenarioBinding) {
    const scenarios = assertPlanningScenariosReady(
      await readJson(paths.planningScenariosFile),
      {slug, intake: project.intake},
    );
    const option = scenarios.options.find(
      ({id}) => id === project.plan.productionProfile,
    );
    if (option) {
      assertStoryboardMatchesScenario(option, storyboard.directingSummary);
    }
  }
  const card = motionLanguageCard(storyboard.motionContract);
  const updatedProject = {
    ...project,
    motionContract: storyboard.motionContract,
    editorial: storyboard.editorial,
    spatialContracts: storyboard.spatialContracts ?? [],
  };
  const soundEffects = await soundEffectArtifactsFor(storyboard);
  await writeJsonTransaction([
    {file: storyboardFileFor(slug), value: storyboard},
    {file: paths.motionLanguageCardFile, value: card},
    {file: paths.projectFile, value: updatedProject},
    ...soundEffects.entries,
  ]);
  await recordMotionLanguageCard(
    slug,
    path.relative(ROOT, paths.motionLanguageCardFile),
  );
  const summary = summarizeStoryboard(storyboard);
  if (json) {
    printCanonicalJson({slug, summary, storyboard});
  } else {
    printStoryboard({slug, summary, storyboard, paths, soundEffects, input});
  }
} catch (error) {
  console.error(`project:storyboard failed: ${error.message}`);
  process.exitCode = 1;
}
