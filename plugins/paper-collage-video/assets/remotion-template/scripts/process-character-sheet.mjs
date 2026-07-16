#!/usr/bin/env node
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './project-lib.mjs';

const args = process.argv.slice(2);
const positionals = args.filter((arg) => !arg.startsWith('--'));
const [input, sourceDirectory, alphaDirectory, prefix, countValue] = positionals;
const count = Number(countValue);
const columns = Number(
  args.find((arg) => arg.startsWith('--columns='))?.slice('--columns='.length) ?? 2,
);
const names = (
  args.find((arg) => arg.startsWith('--names='))?.slice('--names='.length) ?? ''
)
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const python = process.env.PYTHON_BIN || 'python3';

const runInherited = (command, commandArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {cwd: ROOT, stdio: 'inherit'});
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });

try {
  if (!input || !sourceDirectory || !alphaDirectory || !prefix || !Number.isInteger(count) || count < 1) {
    throw new Error(
      '用法：process-character-sheet.mjs <input> <sourceDir> <alphaDir> <prefix> <count> [--columns=2] [--names=a,b,c,d]',
    );
  }
  if (names.length > 0 && names.length !== count) {
    throw new Error(`--names 需要恰好 ${count} 个名称。`);
  }
  await fs.mkdir(path.resolve(ROOT, sourceDirectory), {recursive: true});
  await fs.mkdir(path.resolve(ROOT, alphaDirectory), {recursive: true});
  await runInherited(python, [
    'scripts/split_sheet.py',
    input,
    sourceDirectory,
    prefix,
    String(count),
    '--columns',
    String(columns),
  ]);
  for (let index = 0; index < count; index += 1) {
    const source = path.join(sourceDirectory, `${prefix}-${index + 1}-green.png`);
    const outputName = names[index] || `${prefix}-${index + 1}`;
    const output = path.join(alphaDirectory, `${outputName}.png`);
    await runInherited(python, [
      'scripts/remove_chroma_key.py',
      '--input',
      source,
      '--out',
      output,
      '--transparent-threshold',
      '18',
      '--opaque-threshold',
      '95',
      '--edge-feather',
      '0.6',
      '--force',
    ]);
  }
  console.log(`✓ 已生成 ${count} 个透明角色 PNG：${alphaDirectory}`);
} catch (error) {
  console.error(`assets:process-sheet failed: ${error.message}`);
  process.exitCode = 1;
}
