#!/usr/bin/env node
import fs from 'node:fs/promises';
import {resolveWorkspacePath} from './provider-lib.mjs';
import {loadProject, writeJson} from './project-lib.mjs';
import {loadProduction} from './production-state.mjs';
import {
  storyboardFileFor,
  summarizeStoryboard,
  validateStoryboard,
} from './storyboard-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const input = args.find((arg) => arg.startsWith('--input='))?.slice('--input='.length);

try {
  if (!slug || !input) throw new Error('用法：project:storyboard -- <slug> --input=<storyboard.json>');
  const {state} = await loadProduction(slug);
  if (!['capability-review', 'brief', 'concept-review'].includes(state.stage)) {
    throw new Error(`project:storyboard 只能在 capability-review、brief 或 concept-review 阶段运行；当前为 ${state.stage}。`);
  }
  const {project} = await loadProject(slug);
  if (project.plan?.status !== 'resolved') throw new Error('请先运行 project:plan，再编排故事板。');
  const supplied = JSON.parse(
    await fs.readFile(resolveWorkspacePath(input, 'storyboard 输入路径'), 'utf8'),
  );
  const storyboard = {
    ...supplied,
    $schema: '../../schemas/storyboard.schema.json',
    schemaVersion: 1,
    slug,
    status: 'ready',
    updatedAt: new Date().toISOString(),
  };
  const issues = validateStoryboard(storyboard, {slug, plan: project.plan});
  if (issues.length > 0) {
    throw new Error(issues.map(({location, message}) => `${location}: ${message}`).join('\n'));
  }
  await writeJson(storyboardFileFor(slug), storyboard);
  const summary = summarizeStoryboard(storyboard);
  console.log(`✓ 故事板已锁定：${summary.sceneCount} 个镜头`);
  for (const scene of summary.scenes) {
    console.log(`  ${scene.id}: ${scene.blueprint} · ${scene.beatCount} beats · ${scene.proofCount} proofs`);
  }
} catch (error) {
  console.error(`project:storyboard failed: ${error.message}`);
  process.exitCode = 1;
}
