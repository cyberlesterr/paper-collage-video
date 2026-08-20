#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {ensureAudioCalibrationReady} from './audio-calibration-lib.mjs';
import {loadProject} from './project-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：project:audio-calibration -- <slug> run';
printCliHelp(args, USAGE);
const slug = args.find((argument) => !argument.startsWith('--'));
const action = args.find((argument, index) =>
  index > args.indexOf(slug) && !argument.startsWith('--')) ?? 'run';

try {
  if (!slug) {
    throw new Error(
      USAGE,
    );
  }
  if (action !== 'run') {
    throw new Error(`未知 action：${action}；音频母带是自动技术流程，仅支持 run`);
  }
  const {project} = await loadProject(slug);
  const result = await ensureAudioCalibrationReady({project});
  const calibration = result.calibration;
  if (args.includes('--json')) {
    console.log(JSON.stringify({
      ready: result.ready,
      status: calibration.status,
      sourceFingerprint: calibration.sourceFingerprint,
      currentNarrationVolume: calibration.currentNarrationVolume,
      recommendedNarrationVolume: calibration.recommendedNarrationVolume,
      preflight: result.report,
    }, null, 2));
  } else {
    console.log(
      `${result.ready ? '✓' : '◇'} audio calibration: ${calibration.status}`,
    );
    console.log(`  source fingerprint: ${calibration.sourceFingerprint}`);
    console.log(
      `  narration volume: ${calibration.currentNarrationVolume} → ${calibration.recommendedNarrationVolume.toFixed(3)}`,
    );
    console.log(
      `  preflight: ${result.report.loudness.integratedLufs} LUFS / ${result.report.loudness.truePeakDbtp} dBTP`,
    );
    if (result.report.masteringProcessing?.applied) {
      console.log(
        `  mastering: ${result.report.masteringProcessing.method} / ${result.report.masteringProcessing.attempts.length} attempt(s)`,
      );
    }
    if (!result.ready) {
      console.log('  自动母带未能满足交付契约；请检查音源或处理链，不要请求用户批准技术参数。');
      console.log('  最终成片 report 的实测响度仍是权威结果。');
    }
  }
  if (!result.ready) process.exitCode = 2;
} catch (error) {
  console.error(`project:audio-calibration failed: ${error.message}`);
  process.exitCode = 1;
}
