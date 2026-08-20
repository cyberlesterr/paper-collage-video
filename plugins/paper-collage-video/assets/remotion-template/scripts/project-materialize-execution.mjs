#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import path from 'node:path';
import {parseCliValue} from './contract-utils.mjs';
import {
  loadProject,
  readJson,
  ROOT,
  writeJsonTransaction,
} from './project-lib.mjs';
import {loadStoryboard} from './storyboard-lib.mjs';
import {
  buildExecutionScaffold,
  executionScaffoldChecklist,
  validateExecutionTree,
} from './execution-scaffold-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：project:materialize-execution -- <slug> [--force] [--json]';
printCliHelp(args, USAGE);
const slug = args.find((argument) => !argument.startsWith('--'));
const json = args.includes('--json');

try {
  if (!slug) throw new Error(USAGE);
  const {project, paths} = await loadProject(slug);
  if ((project.scenes ?? []).length > 0 && !args.includes('--force')) {
    throw new Error(
      `${slug} 已有 ${project.scenes.length} 个执行镜头；物化会覆盖它们，确认后加 --force。` +
        '若只是要按当前 storyboard 同步已有执行树，用 project:sync-directing。',
    );
  }
  const storyboard = await loadStoryboard(slug);
  const manifest = await readJson(
    path.join(paths.projectDirectory, 'assets-manifest.json'),
  ).catch(() => null);
  const scaffold = buildExecutionScaffold({project, storyboard, manifest});
  const {markers, review} = executionScaffoldChecklist({scaffold, manifest});
  // Run the blueprint's own checks before writing, so a success line can never
  // again mean "generated" when the next gate will reject it.
  const issues = validateExecutionTree({
    project,
    storyboard,
    scenes: scaffold.scenes,
  });
  if (issues.length > 0) {
    throw new Error(
      `生成的执行树未通过蓝图同款校验（${issues.length} 项），未写入任何项目文件：\n` +
        issues
          .map(({location, message}) => `- ${location}: ${message}`)
          .join('\n'),
    );
  }
  await writeJsonTransaction([
    {
      file: paths.projectFile,
      value: {
        ...project,
        scenes: scaffold.scenes,
        sceneTransitions: scaffold.sceneTransitions,
      },
    },
  ]);
  const nodeCount = scaffold.scenes.reduce(
    (total, scene) => total + scene.composition.nodes.length,
    0,
  );
  if (json) {
    console.log(
      JSON.stringify(
        {slug, sceneCount: scaffold.scenes.length, nodeCount, markers, review},
        null,
        2,
      ),
    );
  } else {
    console.log(
      `✓ 执行树已物化到 ${path.relative(ROOT, paths.projectFile)}：${scaffold.scenes.length} 场 · ${nodeCount} 个节点 · ${scaffold.sceneTransitions.length} 个边界`,
    );
    if (markers.length > 0) {
      console.log('');
      console.log('待补字段：');
      for (const marker of markers) console.log(`  - ${marker}`);
    }
    if (review.length > 0) {
      console.log('');
      console.log('脚手架代填的版面占位（可直接渲染蓝图，但请按真实构图复核）：');
      for (const line of review) console.log(`  ${line}`);
    }
    console.log('');
    console.log(
      `下一步：npm run project:visual-blueprint -- ${slug}（缺失的生产素材会以确定性占位代理呈现）`,
    );
  }
} catch (error) {
  console.error(`project:materialize-execution failed: ${error.message}`);
  process.exitCode = 1;
}
