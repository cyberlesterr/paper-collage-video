#!/usr/bin/env node
import path from 'node:path';
import {
  PROVIDER_CAPABILITIES,
  inspectProviderReadiness,
  loadProviderConfig,
  resolveProvider,
} from './provider-lib.mjs';
import {ROOT} from './project-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--')) ?? null;
const json = args.includes('--json');

try {
  const loaded = await loadProviderConfig(slug);
  const capabilities = {};
  for (const capability of PROVIDER_CAPABILITIES) {
    const provider = resolveProvider(loaded.config, capability);
    capabilities[capability] = {
      provider: {
        id: provider.id,
        label: provider.label,
        adapter: provider.adapter,
        model: provider.model ?? null,
      },
      readiness: await inspectProviderReadiness(provider),
    };
  }
  const summary = {
    slug,
    valid: !loaded.issues.some(({level}) => level === 'error'),
    sources: loaded.sources.map((source) => ({
      ...source,
      file: path.relative(ROOT, source.file),
    })),
    issues: loaded.issues,
    capabilities,
  };
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Provider configuration: ${summary.valid ? 'VALID' : 'INVALID'}`);
    for (const source of summary.sources) {
      console.log(`${source.loaded ? '✓' : '·'} ${source.kind}: ${source.file}`);
    }
    for (const [capability, status] of Object.entries(capabilities)) {
      const symbol = status.readiness.status === 'error' ? '✗' : status.readiness.status === 'ready' ? '✓' : '◇';
      console.log(
        `${symbol} ${capability}: ${status.provider.id} (${status.provider.adapter}) — ${status.readiness.message}`,
      );
    }
    for (const issue of summary.issues) {
      console.log(`${issue.level === 'error' ? '✗' : '⚠'} ${issue.location}: ${issue.message}`);
    }
  }
  if (!summary.valid) process.exitCode = 1;
} catch (error) {
  console.error(`provider:status failed: ${error.message}`);
  process.exitCode = 1;
}
