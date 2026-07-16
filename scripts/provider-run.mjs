#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  assertProviderConfig,
  expandCommandTemplate,
  inspectProviderReadiness,
  loadAssetRequest,
  loadProviderConfig,
  makeCommandContext,
  recordAssetProvenance,
  resolveConfirmedProvider,
  runProviderCommand,
} from './provider-lib.mjs';
import {ROOT} from './project-lib.mjs';

const args = process.argv.slice(2);
const valueFor = (name) =>
  args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const requestInput = valueFor('--request');
const requestedProvider = valueFor('--provider') ?? 'auto';

try {
  if (!requestInput) {
    throw new Error('用法：provider:run -- --request=<request.json> [--provider=<id>]');
  }
  const loadedRequest = await loadAssetRequest(requestInput);
  const loadedConfig = assertProviderConfig(
    await loadProviderConfig(loadedRequest.request.projectSlug),
  );
  const provider = resolveConfirmedProvider(
    loadedConfig.config,
    loadedRequest.request.capability,
    requestedProvider,
  );
  const readiness = await inspectProviderReadiness(provider);
  if (provider.adapter !== 'command') {
    console.error(
      `${provider.id} 使用 ${provider.adapter} adapter，不能由 provider:run 直接调用。\n` +
        `${provider.toolHint ?? '先生成或导入输出文件。'}\n` +
        `完成后运行 provider:record -- --request=${path.relative(ROOT, loadedRequest.file)} --provider=${provider.id}`,
    );
    process.exitCode = 2;
  } else if (readiness.status === 'error') {
    throw new Error(readiness.message);
  } else {
    await fs.mkdir(path.dirname(loadedRequest.output), {recursive: true});
    const context = makeCommandContext({
      requestFile: loadedRequest.file,
      request: loadedRequest.request,
      output: loadedRequest.output,
    });
    const command = provider.command.executable;
    const commandArgs = provider.command.args.map((value) =>
      expandCommandTemplate(value, context),
    );
    const cwd = provider.command.cwd
      ? path.resolve(ROOT, expandCommandTemplate(provider.command.cwd, context))
      : ROOT;
    if (cwd !== ROOT && !cwd.startsWith(`${ROOT}${path.sep}`)) {
      throw new Error(`provider command.cwd 越过工作区：${cwd}`);
    }
    await runProviderCommand(command, commandArgs, {
      cwd,
      timeoutSeconds: provider.command.timeoutSeconds ?? 900,
    });
    const recorded = await recordAssetProvenance({
      request: loadedRequest.request,
      output: loadedRequest.output,
      provider,
    });
    console.log(`✓ provider 输出：${recorded.record.file}`);
    console.log(`✓ 资产溯源：${path.relative(ROOT, recorded.manifestFile)}`);
  }
} catch (error) {
  console.error(`provider:run failed: ${error.message}`);
  process.exitCode = 1;
}
