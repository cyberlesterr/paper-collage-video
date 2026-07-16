#!/usr/bin/env node
import {
  formatValidation,
  loadProject,
  validateProject,
  writeValidationReport,
} from './project-lib.mjs';

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
