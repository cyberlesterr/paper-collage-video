#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  assertSlug,
  fileExists,
  projectPaths,
} from './project-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const titleArgument = args.find((arg) => arg.startsWith('--title='));
const title = titleArgument?.slice('--title='.length) || slug;
const dryRun = args.includes('--dry-run');
const createdAt = new Date().toISOString();

const renderTemplate = (value) =>
  value
    .replaceAll('{{slug}}', slug)
    .replaceAll('{{title}}', title)
    .replaceAll('{{createdAt}}', createdAt);

try {
  assertSlug(slug);
  const paths = projectPaths(slug);
  if (await fileExists(paths.projectDirectory)) {
    throw new Error(`项目已经存在：projects/${slug}`);
  }

  const templateDirectory = path.join(ROOT, 'templates', 'project');
  const templateFiles = [
    'assets-manifest.json',
    'brief.md',
    'project.json',
    'production.json',
    'prompts.json',
    'providers.json',
    'quality-report.json',
    'review.md',
  ];
  const publicDirectories = [
    'assets/plates',
    'assets/characters/source',
    'assets/characters/alpha',
    'audio/narration',
    'audio/music',
    'audio/sfx',
  ];

  console.log(`项目：${slug}`);
  console.log(`标题：${title}`);
  console.log(`配置：projects/${slug}`);
  console.log(`素材：public/projects/${slug}`);
  if (dryRun) {
    console.log('✓ dry-run：未写入文件');
    process.exit(0);
  }

  await fs.mkdir(paths.projectDirectory, {recursive: true});
  for (const templateFile of templateFiles) {
    const source = await fs.readFile(
      path.join(templateDirectory, templateFile),
      'utf8',
    );
    await fs.writeFile(
      path.join(paths.projectDirectory, templateFile),
      renderTemplate(source),
      'utf8',
    );
  }
  await fs.mkdir(path.join(paths.projectDirectory, 'requests'), {recursive: true});
  await fs.writeFile(path.join(paths.projectDirectory, 'requests', '.gitkeep'), '', 'utf8');
  for (const directory of publicDirectories) {
    const absolute = path.join(paths.publicDirectory, directory);
    await fs.mkdir(absolute, {recursive: true});
    await fs.writeFile(path.join(absolute, '.gitkeep'), '', 'utf8');
  }

  console.log('✓ 项目骨架已创建');
  console.log(`下一步：运行 provider:status -- ${slug} --json，检测并确认 text/image/voice provider。`);
} catch (error) {
  console.error(`project:new failed: ${error.message}`);
  process.exitCode = 1;
}
