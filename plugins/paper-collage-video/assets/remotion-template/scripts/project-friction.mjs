#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseCliValue} from './contract-utils.mjs';
import {assertSlug, ROOT} from './project-lib.mjs';
import {
  buildFrictionReport,
  renderFrictionMarkdown,
} from './friction-report-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：project:friction -- <slug> [--json] [--output=<report.md>]';
printCliHelp(args, USAGE);
const slug = args.find((argument) => !argument.startsWith('--'));
const valueFor = (name) => parseCliValue(args, name);

try {
  if (!slug) {
    throw new Error(USAGE);
  }
  assertSlug(slug);
  const report = await buildFrictionReport({slug});
  const output = valueFor('--output');
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const markdown = renderFrictionMarkdown(report);
    if (output) {
      const file = path.resolve(ROOT, output);
      if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) {
        throw new Error(`输出路径越过工作区：${output}`);
      }
      await fs.mkdir(path.dirname(file), {recursive: true});
      await fs.writeFile(file, `${markdown}\n`, 'utf8');
      console.log(`✓ friction 报告：${path.relative(ROOT, file)}`);
    } else {
      console.log(markdown);
    }
  }
} catch (error) {
  console.error(`project:friction failed: ${error.message}`);
  process.exitCode = 1;
}
