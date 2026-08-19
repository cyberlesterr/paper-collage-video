#!/usr/bin/env node
import {parseCliValue} from './contract-utils.mjs';
import path from 'node:path';
import {
  FAILURE_CIRCUIT_ROOT,
  readFailureCircuitEvents,
  resolveFailureCircuit,
  summarizeFailureCircuits,
} from './failure-circuit-lib.mjs';

const args = process.argv.slice(2);
const positionals = args.filter((argument) => !argument.startsWith('--'));
const [slug, action = 'summary'] = positionals;
const valueFor = (name) => parseCliValue(args, name);

try {
  if (!slug || !['summary', 'resolve'].includes(action)) {
    throw new Error(
      '用法：project:failures -- <slug> summary | <slug> resolve --circuit=<id> --note=<人的决定>',
    );
  }
  if (action === 'resolve') {
    const result = await resolveFailureCircuit({
      slug,
      circuitId: valueFor('--circuit'),
      note: valueFor('--note'),
    });
    console.log(`✓ 已按人工决定解除熔断：${result.event.circuitId}`);
    console.log(`  ledger: ${path.relative(FAILURE_CIRCUIT_ROOT, result.file)}`);
  } else {
    const loaded = await readFailureCircuitEvents(slug);
    const summary = summarizeFailureCircuits(loaded.events);
    console.log(`Failure circuits: ${slug}`);
    console.log(`  ledger: ${path.relative(FAILURE_CIRCUIT_ROOT, loaded.file)}`);
    if (summary.circuits.length === 0) {
      console.log('  none');
    }
    for (const circuit of summary.circuits) {
      console.log(
        `  ${circuit.circuitId}: ${circuit.open ? 'OPEN' : 'one-failure'} · ` +
          `${circuit.operation} · ${circuit.count}/2`,
      );
      console.log(`    ${circuit.evidence}`);
    }
  }
} catch (error) {
  console.error(`project:failures failed: ${error.message}`);
  process.exitCode = 1;
}
