#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import path from 'node:path';
import {
  readGenerationAttemptEvents,
  summarizeGenerationAttempts,
} from './generation-attempt-lib.mjs';
import {ROOT, loadProject} from './project-lib.mjs';
import {loadStoryboard} from './storyboard-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：project:budget -- <slug> [--json]';
printCliHelp(args, USAGE);
const slug = args.find((argument) => !argument.startsWith('--'));
const json = args.includes('--json');

try {
  if (!slug) throw new Error(USAGE);
  const [{project}, storyboard, ledger] = await Promise.all([
    loadProject(slug),
    loadStoryboard(slug),
    readGenerationAttemptEvents(slug),
  ]);
  const attempts = summarizeGenerationAttempts(ledger.events);
  const planned = storyboard.directingSummary?.generationBudget ?? {};
  const approval = project.plan?.approvedImageBudget ?? null;
  const profileHardCeiling = project.plan?.assetBudget?.maxGeneratedImages ?? null;
  const maximum = approval?.imageAttemptLimit ?? null;
  const result = {
    schemaVersion: 1,
    projectSlug: slug,
    approval: {
      imageAttemptLimit: maximum,
      expectedProviderImageCallsAtApproval: approval?.expectedProviderImageCalls ?? null,
      profileHardCeiling,
      approvedAt: approval?.approvedAt ?? null,
    },
    storyboard: {
      expectedProviderImageCalls: planned.expectedProviderImageCalls ?? planned.requiredProviderImageCalls ?? null,
      requiredProviderImageCalls: planned.requiredProviderImageCalls ?? null,
      localDerivatives: planned.localDerivatives ?? 0,
      avoidedCalls: planned.avoidedCalls ?? 0,
      hardCeiling: planned.hardCeiling ?? profileHardCeiling,
    },
    attempts: {
      used: attempts.used,
      reserved: attempts.reserved,
      closed: attempts.closed,
      remaining: Number.isInteger(maximum) ? Math.max(0, maximum - attempts.used - attempts.reserved) : null,
      byStatus: attempts.byStatus,
      ledger: path.relative(ROOT, ledger.file),
    },
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`image budget: ${slug}`);
    console.log(`  approved: ${result.approval.imageAttemptLimit ?? 'pending'} / profile ceiling: ${result.approval.profileHardCeiling ?? 'unresolved'} / remaining: ${result.attempts.remaining ?? 'pending'}`);
    console.log(`  storyboard: expected ${result.storyboard.expectedProviderImageCalls ?? 'pending'} provider calls; local derivatives ${result.storyboard.localDerivatives}; avoided ${result.storyboard.avoidedCalls}`);
    console.log(`  actual: used ${result.attempts.used}; reserved ${result.attempts.reserved}; closed ${result.attempts.closed}`);
    console.log(`  ledger: ${result.attempts.ledger}`);
  }
} catch (error) {
  console.error(`project:budget failed: ${error.message}`);
  process.exitCode = 1;
}
