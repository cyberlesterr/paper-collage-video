#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import path from 'node:path';
import {
  ROOT,
  assertSlug,
  readJson,
  writeJson,
} from './project-lib.mjs';
import {storyboardFileFor} from './storyboard-lib.mjs';
import {buildWorldTopologyProof} from './world-topology-proof-lib.mjs';

const USAGE =
  "用法：npm run project:world-topology-proof --";
printCliHelp(process.argv.slice(2), USAGE);

const slug = process.argv.slice(2).find((argument) => !argument.startsWith('--'));

try {
  assertSlug(slug);
  const storyboard = await readJson(storyboardFileFor(slug));
  const report = await buildWorldTopologyProof({
    root: ROOT,
    projectSlug: slug,
    storyboard,
  });
  if (report.worlds.length === 0) {
    throw new Error('当前故事板没有 looping-environment，不需要世界拓扑证明。');
  }
  const reportFile = path.join(
    ROOT,
    'projects',
    slug,
    'world-topology-proof.json',
  );
  await writeJson(reportFile, report);
  if (!report.passed) {
    const failures = report.worlds
      .flatMap((world) =>
        world.checks
          .filter(({passed}) => !passed)
          .map(({id}) => `${world.proofId}/${id}`),
      );
    throw new Error(`世界拓扑证明未通过：${failures.join('、')}`);
  }
  console.log(
    `✓ provider-free world topology: ${report.worlds.length} 个连续世界全部通过。`,
  );
  for (const world of report.worlds) {
    console.log(`  ${world.proofId}: ${world.evidence}`);
  }
  console.log(`✓ report: ${path.relative(ROOT, reportFile)}`);
} catch (error) {
  console.error(`project:world-topology-proof failed: ${error.message}`);
  process.exitCode = 1;
}
