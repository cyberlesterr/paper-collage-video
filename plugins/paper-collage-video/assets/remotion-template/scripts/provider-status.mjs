#!/usr/bin/env node
import path from 'node:path';
import {
  PROVIDER_CAPABILITIES,
  inspectProviderReadiness,
  loadProviderConfig,
  resolveProvider,
  summarizeProviderSelections,
} from './provider-lib.mjs';
import {ROOT} from './project-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--')) ?? null;
const json = args.includes('--json');
const compactJson = args.includes('--compact-json');

try {
  const loaded = await loadProviderConfig(slug);
  const selections = summarizeProviderSelections(loaded.config);
  const capabilities = {};
  for (const capability of PROVIDER_CAPABILITIES) {
    const provider = resolveProvider(loaded.config, capability);
    const candidates = [];
    for (const [id, configured] of Object.entries(
      loaded.config.capabilities?.[capability]?.providers ?? {},
    )) {
      candidates.push({
        id,
        label: configured.label,
        adapter: configured.adapter,
        model: configured.model ?? null,
        tool: configured.tool ?? null,
        readiness: await inspectProviderReadiness({...configured, id, capability}),
      });
    }
    capabilities[capability] = {
      provider: {
        id: provider.id,
        label: provider.label,
        adapter: provider.adapter,
        model: provider.model ?? null,
        tool: provider.tool ?? null,
      },
      readiness: await inspectProviderReadiness(provider),
      candidates,
      ...selections[capability],
    };
  }
  const summary = {
    slug,
    valid: !loaded.issues.some(({level}) => level === 'error'),
    allConfirmed: Object.values(selections).every(({confirmed}) => confirmed),
    sources: loaded.sources.map((source) => ({
      ...source,
      file: path.relative(ROOT, source.file),
    })),
    issues: loaded.issues,
    capabilities,
  };
  if (compactJson) {
    console.log(
      JSON.stringify(
        {
          slug,
          valid: summary.valid,
          allConfirmed: summary.allConfirmed,
          issues: summary.issues,
          capabilities: Object.fromEntries(
            Object.entries(capabilities).map(([capability, status]) => [
              capability,
              {
                provider: status.provider,
                readiness: {
                  status: status.readiness.status,
                  missingEnv: status.readiness.missingEnv,
                },
                confirmed: status.confirmed,
              },
            ]),
          ),
        },
        null,
        2,
      ),
    );
  } else if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Provider configuration: ${summary.valid ? 'VALID' : 'INVALID'}`);
    for (const source of summary.sources) {
      console.log(`${source.loaded ? '✓' : '·'} ${source.kind}: ${source.file}`);
    }
    for (const [capability, status] of Object.entries(capabilities)) {
      const symbol =
        status.readiness.status === 'error'
          ? '✗'
          : status.confirmed
            ? '✓'
            : '◇';
      console.log(
        `${symbol} ${capability}: ${status.provider.id} (${status.provider.adapter}) — ${status.confirmed ? '用户已确认' : '等待用户确认'}；${status.readiness.message}`,
      );
      console.log(
        `  candidates: ${status.candidates.map(({id, readiness}) => `${id}=${readiness.status}`).join(', ')}`,
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
