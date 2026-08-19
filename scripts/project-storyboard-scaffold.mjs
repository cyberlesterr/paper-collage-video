#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseCliValue} from './contract-utils.mjs';
import {loadProject, readJson, ROOT, writeJson} from './project-lib.mjs';
import {
  buildStoryboardScaffold,
  scaffoldCompletionChecklist,
} from './storyboard-scaffold-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((argument) => !argument.startsWith('--'));
const valueFor = (name) => parseCliValue(args, name);

try {
  if (!slug) {
    throw new Error(
      '用法：project:storyboard-scaffold -- <slug> [--output=projects/<slug>/storyboard-input.json] [--force]',
    );
  }
  const {project, paths} = await loadProject(slug);
  if (project.plan?.status !== 'resolved') {
    throw new Error('请先运行 project:plan 选定 scenario，再生成分镜脚手架。');
  }
  const scenariosFile = path.join(paths.projectDirectory, 'planning-scenarios.json');
  const scenarios = await readJson(scenariosFile).catch(() => {
    throw new Error(`缺少 ${path.relative(ROOT, scenariosFile)}；先运行 project:scenarios。`);
  });
  const scaffold = buildStoryboardScaffold({project, scenarios});
  const option = (scenarios.options ?? []).find(
    ({id}) => id === project.plan.scenarioBinding.optionId,
  );
  const output =
    valueFor('--output') ?? `projects/${slug}/storyboard-input.json`;
  const file = path.resolve(ROOT, output);
  if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error(`输出路径越过工作区：${output}`);
  }
  if (!args.includes('--force')) {
    const exists = await fs.stat(file).then((stat) => stat.isFile()).catch(() => false);
    if (exists) {
      throw new Error(`输出已存在：${output}；使用 --force 显式覆盖。`);
    }
  }
  await writeJson(file, scaffold);
  const {markers, obligations} = scaffoldCompletionChecklist({scaffold, option});
  console.log(`✓ 分镜脚手架：${path.relative(ROOT, file)}`);
  console.log(
    `  场景 ${scaffold.scenes.length} · 边界 ${scaffold.sceneTransitions.length} · 待补创意字段 ${markers.length} 处`,
  );
  console.log('');
  console.log('待补字段（全部替换掉 TODO(author) 标记后才能编译）：');
  for (const marker of markers) console.log(`  - ${marker}`);
  if (obligations.length > 0) {
    console.log('');
    console.log('按已批准 scenario 推断的空间合同义务（补进 spatialContracts[]）：');
    for (const line of obligations) console.log(`  ${line}`);
  }
  console.log('');
  console.log(
    '完成后运行：npm run project:storyboard -- ' +
      `${slug} --input=${path.relative(ROOT, file)}`,
  );
} catch (error) {
  console.error(`project:storyboard-scaffold failed: ${error.message}`);
  process.exitCode = 1;
}
