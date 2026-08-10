#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveWorkspacePath} from './provider-lib.mjs';
import {
  loadProject,
  ROOT,
  writeJsonTransaction,
} from './project-lib.mjs';
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

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const input = args.find((arg) => arg.startsWith('--input='))?.slice('--input='.length);

try {
  if (!slug || !input) throw new Error('用法：project:storyboard -- <slug> --input=<storyboard.json>');
  const {state} = await loadProduction(slug);
  if (!['capability-review', 'brief', 'concept-review'].includes(state.stage)) {
    throw new Error(`project:storyboard 只能在 capability-review、brief 或 concept-review 阶段运行；当前为 ${state.stage}。`);
  }
  const {project, paths} = await loadProject(slug);
  if (project.plan?.status !== 'resolved') throw new Error('请先运行 project:plan，再编排故事板。');
  const supplied = JSON.parse(
    await fs.readFile(resolveWorkspacePath(input, 'storyboard 输入路径'), 'utf8'),
  );
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
    `  source packages: ${storyboard.directingSummary.generationBudget.requiredProviderImageCalls} required provider calls · ${storyboard.directingSummary.generationBudget.localDerivatives} local derivatives · ${storyboard.directingSummary.generationBudget.avoidedCalls} calls avoided · hard ceiling ${storyboard.directingSummary.generationBudget.hardCeiling}`,
  );
  console.log(
    `  sound effects: ${soundEffects.plan.requiredSoundEffectCount} unique provider assets · ${soundEffects.requests.length} active requests · ${soundEffects.removedRequests.length} stale requests removed`,
  );
} catch (error) {
  console.error(`project:storyboard failed: ${error.message}`);
  process.exitCode = 1;
}
