#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {parseCliValue} from './contract-utils.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  assertQualityReviewScaffoldCurrent,
  assertQualityReviewContactSheetsCurrent,
  formatQualityStatus,
  buildQualityReviewScaffold,
  createQualityReviewContactSheets,
  HUMAN_VISUAL_REVIEWER_PATTERN,
  prepareQualityReport,
  recordQualityReview,
  recordQualityReviews,
} from './quality-lib.mjs';
import {ROOT} from './project-lib.mjs';
import {
  classifyQualityReviewer,
  finishLatestMetricSegment,
  startMetricSegment,
} from './production-metrics-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：project:quality -- <slug> <prepare|status|scaffold|contact-sheet|accept-human|record|record-batch> [--scope=all|style|batch] [--assets=<id,...>] [--scene=<sceneId,...>] [--input=<reviews.json>] [--output=<path>] [--reviewer=human:<id>] [--note=<用户原话>] [--all] [--quiet] [--json]；也兼容 <action> <slug>。带 --assets/--scene 时生成批次早审脚手架（quality-review-scaffold.batch.json），早审记录直接计入最终审。';
printCliHelp(args, USAGE);
const usage =
  USAGE;
if (args.includes('--help') || args.includes('-h')) {
  console.log(usage);
  process.exit(0);
}
const positionals = args.filter((arg) => !arg.startsWith('--'));
const actions = [
  'prepare',
  'status',
  'scaffold',
  'contact-sheet',
  'accept-human',
  'record',
  'record-batch',
];
const [first, second] = positionals;
const [slug, action = 'status'] = actions.includes(first)
  ? [second, first]
  : [first, second ?? 'status'];
const quiet = args.includes('--quiet');
const json = args.includes('--json');
const valueFor = (name) => parseCliValue(args, name);
const listFor = (name) =>
  (valueFor(name) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

const defaultScaffoldFile = (projectSlug) =>
  path.join(ROOT, 'projects', projectSlug, 'quality-review-scaffold.json');

const defaultPendingScaffoldFile = (projectSlug) =>
  path.join(ROOT, 'projects', projectSlug, 'quality-review-scaffold.pending.json');

const defaultContactSheetDirectory = (projectSlug) =>
  path.join(ROOT, 'dist', projectSlug, 'quality-review-contact-sheets');

const contactSheetDirectoryForScaffold = (projectSlug, scaffold) =>
  scaffold?.reviewScope === 'batch'
    ? `${defaultContactSheetDirectory(projectSlug)}-batch`
    : defaultContactSheetDirectory(projectSlug);

const inspectReviewArtifact = async ({
  file,
  expectedFingerprint,
  fingerprintFor,
}) => {
  const exists = await fs
    .stat(file)
    .then((stat) => stat.isFile())
    .catch(() => false);
  if (!exists) return {file: path.relative(ROOT, file), status: 'missing'};
  try {
    const payload = JSON.parse(await fs.readFile(file, 'utf8'));
    const fingerprint = fingerprintFor(payload);
    return {
      file: path.relative(ROOT, file),
      status: fingerprint === expectedFingerprint ? 'current' : 'stale',
      fingerprint: fingerprint ?? null,
      expectedFingerprint,
    };
  } catch (error) {
    return {
      file: path.relative(ROOT, file),
      status: 'invalid',
      error: error.message,
      expectedFingerprint,
    };
  }
};

const inspectReviewArtifacts = async (projectSlug, status) => {
  const expectedFingerprint = status.report.reviewSurfaceFingerprint;
  return {
    scaffold: await inspectReviewArtifact({
      file: defaultScaffoldFile(projectSlug),
      expectedFingerprint,
      fingerprintFor: (payload) => payload?.sourceReport?.fingerprint,
    }),
    pendingScaffold: await inspectReviewArtifact({
      file: defaultPendingScaffoldFile(projectSlug),
      expectedFingerprint,
      fingerprintFor: (payload) => payload?.sourceReport?.fingerprint,
    }),
    contactSheets: await inspectReviewArtifact({
      file: path.join(defaultContactSheetDirectory(projectSlug), 'index.json'),
      expectedFingerprint,
      fingerprintFor: (payload) => payload?.sourceReport?.fingerprint,
    }),
  };
};

try {
  if (!slug || !actions.includes(action)) {
    throw new Error(usage);
  }
  let status;
  let incrementalScaffold = null;
  let contactSheets = null;
  if (action === 'scaffold') {
    const batchAssets = (valueFor('--assets') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const batchScenes = (valueFor('--scene') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const hasBatchFilter = batchAssets.length > 0 || batchScenes.length > 0;
    const reviewScope =
      valueFor('--scope') ?? (hasBatchFilter ? 'batch' : 'all');
    const built = await buildQualityReviewScaffold({
      slug,
      reviewer: valueFor('--reviewer') ?? 'human:pending',
      includePassed: args.includes('--all'),
      reviewScope,
      assetFilter: hasBatchFilter
        ? {assetIds: batchAssets, sceneIds: batchScenes}
        : null,
    });
    status = built.status;
    const output =
      valueFor('--output') ??
      (reviewScope === 'batch'
        ? `projects/${slug}/quality-review-scaffold.batch.json`
        : `projects/${slug}/quality-review-scaffold.json`);
    const file = path.resolve(ROOT, output);
    if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) {
      throw new Error(`scaffold 路径越过工作区：${output}`);
    }
    if (!args.includes('--force')) {
      const exists = await fs.stat(file).then((stat) => stat.isFile()).catch(() => false);
      if (exists) throw new Error(`scaffold 已存在：${output}；使用 --force 显式覆盖。`);
    }
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, `${JSON.stringify(built.scaffold, null, 2)}\n`, 'utf8');
    console.log(`✓ 质量审核脚手架：${path.relative(ROOT, file)} (${built.scaffold.reviews.length} reviews)`);
    if (built.scaffold.reviews.length > 0) {
      const reviewer = valueFor('--reviewer') ?? 'human:pending';
      await startMetricSegment({
        slug,
        category: classifyQualityReviewer(reviewer),
        operation: 'quality-review',
        measurement: 'review-session-window',
        metadata: {
          reviewer,
          reviewCount: built.scaffold.reviews.length,
          scaffold: path.relative(ROOT, file),
        },
      });
    }
  } else if (action === 'contact-sheet') {
    const input =
      valueFor('--input') ??
      path.relative(ROOT, defaultScaffoldFile(slug));
    const file = path.resolve(ROOT, input);
    if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) {
      throw new Error(`scaffold 路径越过工作区：${input}`);
    }
    const scaffold = JSON.parse(await fs.readFile(file, 'utf8'));
    status = await assertQualityReviewScaffoldCurrent({slug, scaffold});
    const output = valueFor('--output');
    const outputDirectory = output
      ? path.resolve(ROOT, output)
      : contactSheetDirectoryForScaffold(slug, scaffold);
    contactSheets = await createQualityReviewContactSheets({
      slug,
      scaffold,
      outputDirectory,
    });
  } else if (action === 'accept-human') {
    const input =
      valueFor('--input') ??
      path.relative(ROOT, defaultScaffoldFile(slug));
    const file = path.resolve(ROOT, input);
    if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) {
      throw new Error(`scaffold 路径越过工作区：${input}`);
    }
    const scaffold = JSON.parse(await fs.readFile(file, 'utf8'));
    await assertQualityReviewScaffoldCurrent({slug, scaffold});
    const reviewer = valueFor('--reviewer') ?? '';
    const note = valueFor('--note') ?? '';
    if (!HUMAN_VISUAL_REVIEWER_PATTERN.test(reviewer)) {
      throw new Error('accept-human 必须提供 --reviewer=human:<id>。');
    }
    if (!note.trim()) {
      throw new Error('accept-human 必须用 --note 保留用户的明确批准原话。');
    }
    const contactSheetIndex = path.join(
      contactSheetDirectoryForScaffold(slug, scaffold),
      'index.json',
    );
    await assertQualityReviewContactSheetsCurrent({
      slug,
      scaffold,
      indexFile: contactSheetIndex,
    });
    const reviews = scaffold.reviews
      .filter(({pendingChecks}) => pendingChecks.length > 0)
      .map((review) => ({
        ...review,
        reviewer,
        passedChecks: review.pendingChecks,
        failedChecks: [],
        note,
      }));
    if (reviews.length === 0) {
      throw new Error('当前审核面没有待人工判断的视觉项。');
    }
    status = await recordQualityReviews({
      slug,
      reviews,
      sourceReportFingerprint: scaffold.sourceReport.fingerprint,
      allowPendingSemanticEvidenceTargets:
        scaffold.reviewScope === 'style',
    });
    await finishLatestMetricSegment({
      slug,
      operation: 'quality-review',
      metadata: {
        reviewers: [reviewer],
        recordedReviewCount: reviews.length,
        input: path.relative(ROOT, file),
        decisionMode: 'single-human-visual-decision',
      },
    });
    console.log(
      `✓ 已记录一次人工视觉批准：${reviews.length} 项 · ${reviewer}`,
    );
  } else if (action === 'record') {
    status = await recordQualityReview({
          slug,
          assetId: valueFor('--asset'),
          compositeId: valueFor('--composite'),
          reviewer: valueFor('--reviewer'),
          passedChecks: listFor('--pass'),
          failedChecks: listFor('--fail'),
          note: valueFor('--note') ?? '',
        });
  } else if (action === 'record-batch') {
    const input = valueFor('--input');
    if (!input) throw new Error('record-batch 必须提供 --input=<reviews.json>。');
    const file = path.resolve(ROOT, input);
    if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) {
      throw new Error(`reviews 路径越过工作区：${input}`);
    }
    const payload = JSON.parse(await fs.readFile(file, 'utf8'));
    if (Array.isArray(payload)) {
      throw new Error(
        'record-batch 必须使用 project:quality scaffold 生成的 schemaVersion 4 对象，不能提交未绑定报告指纹和证据哈希的裸数组。',
      );
    }
    await assertQualityReviewScaffoldCurrent({slug, scaffold: payload});
    status = await recordQualityReviews({
      slug,
      reviews: payload.reviews,
      sourceReportFingerprint: payload.sourceReport.fingerprint,
      allowPendingSemanticEvidenceTargets:
        payload.reviewScope === 'style',
    });
    const reviews = payload.reviews;
    await finishLatestMetricSegment({
      slug,
      operation: 'quality-review',
      metadata: {
        reviewers: [...new Set(reviews.map(({reviewer}) => reviewer).filter(Boolean))],
        recordedReviewCount: reviews.length,
        input: path.relative(ROOT, file),
      },
    });
    if (status.pending > 0) {
      const built = await buildQualityReviewScaffold({
        slug,
        reviewer:
          reviews.find(({reviewer}) => reviewer?.trim())?.reviewer ??
          'human:pending',
        reviewScope: payload.reviewScope ?? 'all',
      });
      const pendingFile = defaultPendingScaffoldFile(slug);
      await fs.writeFile(
        pendingFile,
        `${JSON.stringify(built.scaffold, null, 2)}\n`,
        'utf8',
      );
      incrementalScaffold = {
        file: path.relative(ROOT, pendingFile),
        reviewCount: built.scaffold.reviews.length,
        reviewIds: built.scaffold.reviews.map(
          (review) => review.assetId ?? review.compositeId,
        ),
        sourceReportFingerprint:
          built.scaffold.sourceReport.fingerprint,
      };
      status = built.status;
      await startMetricSegment({
        slug,
        category: classifyQualityReviewer(
          built.scaffold.reviews[0]?.reviewer ?? 'human:pending',
        ),
        operation: 'quality-review',
        measurement: 'review-session-window',
        metadata: {
          reviewer:
            built.scaffold.reviews[0]?.reviewer ?? 'human:pending',
          reviewCount: built.scaffold.reviews.length,
          scaffold: path.relative(ROOT, pendingFile),
          incremental: true,
        },
      });
    }
  } else {
    const reviewScope = valueFor('--scope') ?? 'all';
    status = await prepareQualityReport(slug, {
      write: action === 'prepare',
      allowPendingSemanticEvidenceTargets: reviewScope === 'style',
    });
  }
  const reviewArtifacts = await inspectReviewArtifacts(slug, status);
  if (action === 'scaffold') {
    // The scaffold path is the complete output for this action.
  } else if (action === 'contact-sheet') {
    if (json) {
      console.log(
        JSON.stringify(
          {
            reviewSurfaceFingerprint:
              status.report.reviewSurfaceFingerprint,
            index: path.relative(ROOT, contactSheets.file),
            pages: contactSheets.index.pages,
            reviewArtifacts,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(
        `✓ 当前审核联系表：${path.relative(ROOT, contactSheets.file)} (${contactSheets.index.pages.length} pages)`,
      );
    }
  } else if (json) {
    console.log(
      JSON.stringify(
        {
          ready: status.ready,
          total: status.total,
          passed: status.passed,
          pending: status.pending,
          failed: status.failed,
          changedAssets: status.changedAssets ?? [],
          changedComposites: status.changedComposites ?? [],
          reviewSurfaceFingerprint:
            status.report.reviewSurfaceFingerprint,
          reviewArtifacts,
          incrementalScaffold,
          contactSheets: contactSheets
            ? {
                index: path.relative(ROOT, contactSheets.file),
                pages: contactSheets.index.pages,
              }
            : null,
          report: path.relative(ROOT, status.file),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatQualityStatus(status));
    console.log(`  report: ${path.relative(ROOT, status.file)}`);
    for (const [kind, artifact] of Object.entries(reviewArtifacts)) {
      if (artifact.status === 'missing') continue;
      console.log(`  ${kind}: ${artifact.status} (${artifact.file})`);
    }
    if (incrementalScaffold) {
      console.log(
        `  remaining: ${incrementalScaffold.reviewCount} review(s) → ${incrementalScaffold.file}`,
      );
    }
  }
  if (action !== 'scaffold' && !quiet && !json) {
    const changedIds = status.changedIds ?? [];
    const entries = [...status.report.assets, ...status.report.composites];
    const visibleEntries = changedIds.length
      ? entries.filter((entry) => changedIds.includes(entry.assetId ?? entry.compositeId))
      : entries.filter(({status: entryStatus}) => entryStatus !== 'passed');
    for (const entry of visibleEntries) {
      const pending = Object.entries(entry.semanticChecks)
        .filter(([, checkStatus]) => checkStatus !== 'passed')
        .map(([check, checkStatus]) => `${check}:${checkStatus}`)
        .join(', ');
      console.log(`  ${entry.status === 'passed' ? '✓' : '•'} ${entry.assetId ?? entry.compositeId}: ${entry.status}${pending ? ` (${pending})` : ''}`);
    }
  }
  if (action === 'status' && !status.ready) process.exitCode = 1;
} catch (error) {
  console.error(`project:quality failed: ${error.message}`);
  process.exitCode = 1;
}
