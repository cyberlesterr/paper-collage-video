#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {prepareAlphaBandProof} from './asset-hardening-proof-lib.mjs';

const USAGE =
  "用法：npm run proof:alpha-bands --";
printCliHelp(process.argv.slice(2), USAGE);

try {
  const report = await prepareAlphaBandProof();
  console.log(
    `✓ F037 alpha-band proof: ${report.results
      .map(({kind, actualPassed}) => `${kind}=${actualPassed ? 'pass' : 'detected'}`)
      .join(', ')}`,
  );
} catch (error) {
  console.error(`proof:alpha-bands failed: ${error.message}`);
  process.exitCode = 1;
}
