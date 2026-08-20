#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {
  formatValidation,
  loadProject,
  validateProject,
  writeValidationReport,
} from './project-lib.mjs';

const USAGE =
  "用法：npm run project:validate -- <slug>";
printCliHelp(process.argv.slice(2), USAGE);

const slug = process.argv[2];

try {
  const {project} = await loadProject(slug);
  const report = await validateProject(project);
  const reportFile = await writeValidationReport(slug, report);
  console.log(formatValidation(report));
  console.log(`  report: ${reportFile}`);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  console.error(`project:validate failed: ${error.message}`);
  process.exitCode = 1;
}
