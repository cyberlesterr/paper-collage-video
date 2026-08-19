#!/usr/bin/env node
import {parseCliValue} from './contract-utils.mjs';
import {
  approveImageBudgetIncrease,
} from './creative-plan-lib.mjs';
import {
  readGenerationAttemptEvents,
  summarizeGenerationAttempts,
} from './generation-attempt-lib.mjs';
import {
  loadProject,
  writeJson,
} from './project-lib.mjs';
import {
  loadProduction,
  syncReviewFromProduction,
  transitionProduction,
} from './production-state.mjs';

const args = process.argv.slice(2);
const slug = args.find((argument) => !argument.startsWith('--'));
const valueFor = (name) => parseCliValue(args, name);

try {
  if (!slug) {
    throw new Error(
      '用法：project:increase-image-budget -- <slug> --limit=<整数> --note=<人的明确决定> [--json]',
    );
  }
  const imageAttemptLimit = Number(valueFor('--limit'));
  const humanNote = valueFor('--note') ?? '';
  const at = new Date().toISOString();
  const [{paths, project}, {state: production}, ledger] = await Promise.all([
    loadProject(slug),
    loadProduction(slug),
    readGenerationAttemptEvents(slug),
  ]);
  const attempts = summarizeGenerationAttempts(ledger.events);
  const approved = approveImageBudgetIncrease({
    plan: project.plan,
    imageAttemptLimit,
    attempts,
    humanNote,
    at,
  });
  const note =
    `图片尝试上限 ${approved.revision.fromLimit} → ${approved.revision.toLimit}；` +
    humanNote.trim();
  const nextProduction = transitionProduction(
    production,
    'approve-image-budget-increase',
    {at, note},
  );
  project.plan = approved.plan;
  await writeJson(paths.projectFile, project);
  await writeJson(paths.productionFile, nextProduction);
  await syncReviewFromProduction(slug, nextProduction);

  const result = {
    projectSlug: slug,
    stage: nextProduction.stage,
    revision: approved.revision,
    remaining: imageAttemptLimit - attempts.used - attempts.reserved,
  };
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `✓ 已记录图片预算增额：${approved.revision.fromLimit} → ${approved.revision.toLimit}`,
    );
    console.log(
      `  used ${attempts.used} + reserved ${attempts.reserved}; remaining ${result.remaining}`,
    );
    console.log(`  stage: ${nextProduction.stage}`);
  }
} catch (error) {
  console.error(`project:increase-image-budget failed: ${error.message}`);
  process.exitCode = 1;
}
