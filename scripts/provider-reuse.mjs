#!/usr/bin/env node
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  assertProviderConfig,
  createRequestFingerprint,
  loadAssetRequest,
  loadProviderConfig,
  recordAssetProvenance,
  resolveWorkspacePath,
  resolveConfirmedProvider,
} from './provider-lib.mjs';
import {ROOT, fileExists, readJson} from './project-lib.mjs';

const args = process.argv.slice(2);
const valueFor = (name) =>
  args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);

const hashFile = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

try {
  const requestInput = valueFor('--request');
  if (!requestInput) {
    throw new Error('用法：provider:reuse -- --request=<request.json>');
  }
  const loadedRequest = await loadAssetRequest(requestInput);
  const loadedConfig = assertProviderConfig(
    await loadProviderConfig(loadedRequest.request.projectSlug),
  );
  const provider = resolveConfirmedProvider(
    loadedConfig.config,
    loadedRequest.request.capability,
  );
  const targetModel = loadedRequest.request.model || provider.model || null;
  const targetFingerprint = createRequestFingerprint({
    request: loadedRequest.request,
    providerId: provider.id,
    model: targetModel,
  });

  const projectsRoot = path.join(ROOT, 'projects');
  const projectEntries = await fs.readdir(projectsRoot, {withFileTypes: true});
  let match = null;
  for (const entry of projectEntries) {
    if (!entry.isDirectory()) continue;
    const manifestFile = path.join(projectsRoot, entry.name, 'assets-manifest.json');
    if (!(await fileExists(manifestFile))) continue;
    const manifest = await readJson(manifestFile);
    for (const record of manifest.assets ?? []) {
      if (record.requestFingerprint !== targetFingerprint) continue;
      let source;
      try {
        source = resolveWorkspacePath(record.file, '缓存资产路径');
      } catch {
        continue;
      }
      if (!(await fileExists(source))) continue;
      if ((await hashFile(source)) !== record.sha256) continue;
      match = {record, source};
      break;
    }
    if (match) break;
  }
  if (!match) throw new Error('没有找到请求指纹完全一致且哈希有效的可复用资产。');

  await fs.mkdir(path.dirname(loadedRequest.output), {recursive: true});
  if (path.resolve(match.source) !== path.resolve(loadedRequest.output)) {
    await fs.copyFile(match.source, loadedRequest.output);
  }
  const recorded = await recordAssetProvenance({
    request: loadedRequest.request,
    output: loadedRequest.output,
    provider,
    model: match.record.model,
    externalId: match.record.externalId,
    reusedFrom: match.record.file,
  });
  console.log(`✓ 已复用资产：${recorded.record.file}`);
  console.log(`  source: ${match.record.file}`);
} catch (error) {
  console.error(`provider:reuse failed: ${error.message}`);
  process.exitCode = 1;
}
