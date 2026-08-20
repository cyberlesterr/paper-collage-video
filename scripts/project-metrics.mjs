#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {refreshProductionMetrics} from './production-metrics-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：project:metrics -- <slug> [--json]';
printCliHelp(args, USAGE);
const slug = args.find((argument) => !argument.startsWith('--'));

const seconds = (milliseconds) => Math.round(milliseconds / 100) / 10;

try {
  if (!slug) throw new Error(USAGE);
  const metrics = await refreshProductionMetrics(slug);
  if (args.includes('--json')) {
    console.log(JSON.stringify(metrics, null, 2));
  } else {
    const {summary} = metrics;
    console.log(`production metrics: ${slug}`);
    console.log(
      `  observation: ${seconds(summary.observation.durationMs)}s (${summary.coverage.status} coverage)`,
    );
    console.log(
      `  ai-review: ${seconds(summary.aiReview.durationMs)}s · ${summary.aiReview.percentOfObservation}% · ${summary.aiReview.segmentCount} sessions`,
    );
    for (const category of ['ai-generation', 'evidence-render', 'video-render', 'deterministic-check', 'human-review']) {
      const entry = summary.byCategory[category];
      console.log(
        `  ${category}: ${seconds(entry.durationMs)}s · ${entry.percentOfObservation}% · ${entry.segmentCount} segments`,
      );
    }
    console.log(
      `  unattributed: ${seconds(summary.unattributedMs)}s · ${summary.unattributedPercentOfObservation}%`,
    );
  }
} catch (error) {
  console.error(`project:metrics failed: ${error.message}`);
  process.exitCode = 1;
}
