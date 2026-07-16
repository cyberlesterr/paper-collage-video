#!/usr/bin/env node
import path from 'node:path';
import {PROVIDER_CAPABILITIES, writeProviderSelection} from './provider-lib.mjs';
import {ROOT} from './project-lib.mjs';

const args = process.argv.slice(2);
const positionals = args.filter((arg) => !arg.startsWith('--'));
const [slug, capability, providerId] = positionals;
const valueFor = (name) =>
  args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);

try {
  if (!slug || !capability || !providerId) {
    throw new Error(
      `用法：provider:select -- <slug> <${PROVIDER_CAPABILITIES.join('|')}> <provider-id> ` +
        '--note=<人的决定> [--scope=project|workspace] [--label=<名称>] [--adapter=host|manual] [--tool=<tool-name>] [--model=<model>]',
    );
  }
  const result = await writeProviderSelection({
    slug,
    capability,
    providerId,
    scope: valueFor('--scope') ?? 'project',
    label: valueFor('--label'),
    adapter: valueFor('--adapter'),
    tool: valueFor('--tool'),
    model: valueFor('--model'),
    note: valueFor('--note'),
  });
  console.log(
    `✓ 已确认 ${capability} provider：${result.provider.id} (${result.provider.adapter})`,
  );
  console.log(`✓ 选择记录：${path.relative(ROOT, result.target)}`);
  console.log(`  scope: ${result.selection.scope}`);
  if (result.provider.tool) console.log(`  tool: ${result.provider.tool}`);
  if (result.provider.model) console.log(`  model: ${result.provider.model}`);
} catch (error) {
  console.error(`provider:select failed: ${error.message}`);
  process.exitCode = 1;
}
