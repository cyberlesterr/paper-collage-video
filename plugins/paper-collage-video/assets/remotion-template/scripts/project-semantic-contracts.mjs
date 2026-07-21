#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT, assertSlug, fileExists, loadProject} from './project-lib.mjs';
import {
  validateSemanticEvidenceTargets,
  writeSemanticContracts,
} from './semantic-contract-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const inputArgument = args.find((arg) => arg.startsWith('--input='));

try {
  assertSlug(slug);
  if (!(await fileExists(path.join(ROOT, 'projects', slug, 'project.json')))) {
    throw new Error(`项目不存在：${slug}；请先运行 project:new。`);
  }
  if (!inputArgument) {
    throw new Error('用法：project:semantic-contracts -- <slug> --input=<contracts.json>');
  }
  const inputFile = path.resolve(ROOT, inputArgument.slice('--input='.length));
  if (inputFile !== ROOT && !inputFile.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error('contracts 输入路径越过工作区。');
  }
  const input = JSON.parse(await fs.readFile(inputFile, 'utf8'));
  const {project} = await loadProject(slug);
  const targetIssues = validateSemanticEvidenceTargets(input, project);
  if (targetIssues.length) throw new Error(targetIssues.join('\n'));
  const result = await writeSemanticContracts({slug, input});
  console.log(`✓ 语义契约已锁定：${path.relative(ROOT, result.file)}`);
  console.log(`  contracts: ${result.document.contracts.length}`);
} catch (error) {
  console.error(`project:semantic-contracts failed: ${error.message}`);
  process.exitCode = 1;
}
