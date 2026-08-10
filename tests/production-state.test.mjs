import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  assessHandoff,
  formatProduction,
  getStageControl,
  HUMAN_APPROVAL_STAGES,
  HUMAN_GATE_STAGES,
  mergeReviewDocument,
  PRODUCTION_STAGES,
  renderReviewSection,
  resolveAssetsReadyMode,
  summarizeResumeState,
  transitionProduction,
  transitionDirectingRevision,
  transitionRender,
  transitionWorkItem,
} from '../scripts/production-state.mjs';
import {assertAssetsReadySealCurrent} from '../scripts/assets-ready-seal-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const approval = (status = 'pending', note = '') => ({
  status,
  decidedAt: status === 'pending' ? null : '2026-07-16T00:00:00.000Z',
  note,
});

const makeState = (stage) => ({
  $schema: '../../schemas/production.schema.json',
  schemaVersion: 1,
  slug: 'test-film',
  stage,
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
  approvals: {
    concept: approval('approved', '概念通过'),
    styleAndVoice: approval('approved', '风格通过'),
    preview: approval(stage === 'final-render' ? 'approved' : 'pending'),
    publish: approval(),
  },
  workItems: [],
  artifacts: {
    brief: 'projects/test-film/brief.md',
    project: 'projects/test-film/project.json',
    storyboard: 'projects/test-film/storyboard.json',
    prompts: 'projects/test-film/prompts.json',
    review: 'projects/test-film/review.md',
    validationReport: null,
    assetsReadySeal: null,
    preview: null,
    final: null,
    report: null,
    contactSheet: null,
  },
  history: [
    {
      at: '2026-07-16T00:00:00.000Z',
      action: 'project-created',
      stage: 'capability-review',
      note: '',
    },
  ],
});

test('publication is no longer a default human wait stage', () => {
  assert.deepEqual(PRODUCTION_STAGES, [
    'capability-review',
    'brief',
    'concept-review',
    'style-review',
    'asset-production',
    'preview',
    'human-review',
    'final-render',
    'complete',
  ]);
  const waitingStages = PRODUCTION_STAGES.filter(
    (stage) => getStageControl(makeState(stage)).mode === 'wait-human',
  );
  assert.deepEqual(waitingStages, [
    'capability-review',
    'concept-review',
    'style-review',
    'human-review',
  ]);
  assert.deepEqual(waitingStages, [...HUMAN_GATE_STAGES]);
  assert.deepEqual([...HUMAN_APPROVAL_STAGES], [
    'concept-review',
    'style-review',
    'human-review',
  ]);
  assert.throws(
    () => getStageControl(makeState('publish-approval')),
    /未知 stage：publish-approval/,
  );
  const productionSchema = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, 'schemas', 'production.schema.json'),
      'utf8',
    ),
  );
  assert.deepEqual(
    productionSchema.properties.stage.enum,
    PRODUCTION_STAGES,
  );
});

test('automatic stages explicitly prohibit normal turn termination', () => {
  for (const stage of ['brief', 'asset-production', 'preview', 'final-render']) {
    const control = getStageControl(makeState(stage));
    assert.equal(control.mode, 'auto-continue');
    assert.equal(control.mayEndTurn, false);
    assert.ok(control.nextCommand);
    assert.equal(control.requiredDecision, null);
  }
});

test('capability confirmation requires a recorded human decision', () => {
  const current = makeState('capability-review');
  assert.throws(
    () => transitionProduction(current, 'capabilities-ready'),
    /必须用 --note/,
  );
  const next = transitionProduction(current, 'capabilities-ready', {
    note: '使用已检测到的宿主能力，并手工导入旁白',
    at: '2026-07-16T00:01:00.000Z',
  });
  assert.equal(next.stage, 'brief');
  assert.equal(next.history.at(-1).action, 'capabilities-ready');
});

test('handoff guard blocks automatic stages unless a real blocker is explicit', () => {
  const state = makeState('asset-production');
  const normal = assessHandoff(state);
  assert.equal(normal.allowed, false);
  assert.match(normal.message, /不得结束回合/);

  const blocked = assessHandoff(state, {
    blocker: '素材提供方要求重新授权',
    needsUser: '确认是否授权继续生成',
  });
  assert.equal(blocked.allowed, true);
  assert.equal(blocked.reason, 'explicit-blocker');

  assert.equal(assessHandoff(makeState('human-review')).allowed, true);
});

test('resume summaries omit completed history and expose one handoff decision', () => {
  const state = makeState('asset-production');
  state.workItems = [
    {
      id: 'done',
      label: 'Done',
      status: 'completed',
      updatedAt: state.updatedAt,
      artifact: 'public/done.png',
      note: '',
    },
    {
      id: 'next',
      label: 'Next',
      status: 'pending',
      updatedAt: state.updatedAt,
      artifact: null,
      note: '',
    },
  ];
  const summary = summarizeResumeState(state, {
    productionProfile: 'balanced',
  });
  assert.deepEqual(Object.keys(summary), [
    'slug',
    'stage',
    'productionProfile',
    'storyboard',
    'control',
    'handoff',
  ]);
  assert.equal(summary.control.workItems.remaining.length, 1);
  assert.equal(summary.control.workItems.remaining[0].id, 'next');
  assert.equal(summary.control.nextCommand, null);
  assert.equal(summary.handoff.allowed, false);
  assert.equal(JSON.stringify(summary).includes('history'), false);
  assert.equal(summarizeResumeState(state).productionProfile, null);

  state.workItems = [];
  assert.equal(
    summarizeResumeState(state).control.nextCommand,
    'npm run project:assets-ready -- test-film',
  );
});

test('assets-ready advances once and becomes an idempotent preview recheck', () => {
  assert.equal(resolveAssetsReadyMode('asset-production'), 'advance');
  assert.equal(resolveAssetsReadyMode('preview'), 'recheck');
  assert.equal(resolveAssetsReadyMode('human-review'), 'recheck');
  assert.throws(() => resolveAssetsReadyMode('style-review'), /只能在/);
});

test('assets-ready settles validated directing revisions and blocks other unfinished work', () => {
  const current = makeState('asset-production');
  current.workItems = [
    {
      id: 'directing-revision-scene-02',
      label: '重新验证导演重编镜头 scene-02',
      status: 'pending',
      updatedAt: current.updatedAt,
      artifact: 'projects/test-film/directing-revision.json',
      note: '按新 storyboard 同步 project.json 执行树并重新验证。',
    },
  ];
  const ready = transitionProduction(current, 'assets-ready', {
    artifacts: {
      validationReport: 'dist/test-film/validation-report.json',
      assetsReadySeal: 'dist/test-film/assets-ready-seal.json',
    },
    at: '2026-07-23T02:00:00.000Z',
  });
  assert.equal(ready.stage, 'preview');
  assert.equal(ready.workItems[0].status, 'completed');
  assert.equal(ready.workItems[0].artifact, 'projects/test-film/project.json');
  assert.match(ready.workItems[0].note, /satisfied-by-assets-ready/);
  assert.equal(
    ready.history.some(
      ({action, note}) =>
        action === 'work-item-completed' &&
        note.includes('directing-revision-scene-02'),
    ),
    true,
  );

  const unrelated = makeState('asset-production');
  unrelated.workItems = [
    {
      id: 'narration-01',
      label: '第一幕旁白',
      status: 'pending',
      updatedAt: unrelated.updatedAt,
      artifact: null,
      note: '',
    },
  ];
  assert.throws(
    () => transitionProduction(unrelated, 'assets-ready'),
    /narration-01\(pending\)/,
  );

  const blockedRevision = makeState('asset-production');
  blockedRevision.workItems = [
    {
      id: 'directing-revision-scene-02',
      label: '重新验证导演重编镜头 scene-02',
      status: 'blocked',
      updatedAt: blockedRevision.updatedAt,
      artifact: 'projects/test-film/directing-revision.json',
      note: '执行树无法通过验证。',
    },
  ];
  assert.throws(
    () => transitionProduction(blockedRevision, 'assets-ready'),
    /directing-revision-scene-02\(blocked\)/,
  );
});

test('assets-ready seal is recorded and invalidated with preview revisions', () => {
  const ready = transitionProduction(makeState('asset-production'), 'assets-ready', {
    artifacts: {
      validationReport: 'dist/test-film/validation-report.json',
      assetsReadySeal: 'dist/test-film/assets-ready-seal.json',
    },
  });
  assert.equal(ready.stage, 'preview');
  assert.equal(
    ready.artifacts.assetsReadySeal,
    'dist/test-film/assets-ready-seal.json',
  );
  ready.stage = 'human-review';
  ready.artifacts.preview = 'dist/test-film/preview.mp4';
  const revised = transitionProduction(ready, 'request-preview-revision', {
    note: '字幕位置需要调整',
  });
  assert.equal(revised.stage, 'asset-production');
  assert.equal(revised.artifacts.assetsReadySeal, null);
  assert.equal(revised.artifacts.preview, null);
  assert.equal(revised.artifacts.report, null);
});

test('image budget increase records a human decision without changing the production stage', () => {
  const current = makeState('asset-production');
  const next = transitionProduction(current, 'approve-image-budget-increase', {
    note: '图片尝试上限 12 → 14；新增两次环境素材调用',
  });
  assert.equal(next.stage, 'asset-production');
  assert.equal(next.history.at(-1).action, 'approve-image-budget-increase');
  assert.throws(
    () => transitionProduction(current, 'approve-image-budget-increase'),
    /必须用 --note 记录人的明确决定/,
  );
});

test('assets-ready cannot be asserted without the canonical seal', async () => {
  await assert.rejects(
    () => assertAssetsReadySealCurrent(`missing-seal-${process.pid}`),
    /必须运行 project:assets-ready/,
  );
});

test('directing revision is a gated preview-return transition', () => {
  const current = makeState('asset-production');
  current.approvals.preview = approval('changes-requested', '节奏需调整');
  current.history.push({
    at: '2026-07-23T00:00:00.000Z',
    action: 'request-preview-revision',
    stage: 'asset-production',
    note: '节奏需调整',
  });
  current.artifacts.preview = 'dist/test-film/preview.mp4';
  const next = transitionDirectingRevision(current, {
    changedSceneIds: ['scene-01'],
    reportPath: 'projects/test-film/directing-revision.json',
    at: '2026-07-23T01:00:00.000Z',
  });
  assert.equal(next.stage, 'asset-production');
  assert.equal(next.artifacts.preview, null);
  assert.equal(next.approvals.concept.status, 'approved');
  assert.equal(next.history.at(-1).action, 'revise-preview-directing');
  assert.throws(() => transitionDirectingRevision(makeState('asset-production'), {
    changedSceneIds: ['scene-01'],
    reportPath: 'projects/test-film/directing-revision.json',
  }), /只能响应已记录/);
});

test('directing revision can correct execution topology during style review without fabricating style approval', () => {
  const current = makeState('style-review');
  current.approvals.concept = approval('approved', '概念已确认');
  current.approvals.styleAndVoice = approval('pending');
  const next = transitionDirectingRevision(current, {
    source: 'style-review',
    changedSceneIds: ['scene-01'],
    reportPath: 'projects/test-film/directing-revision.json',
    at: '2026-07-25T01:00:00.000Z',
  });
  assert.equal(next.stage, 'style-review');
  assert.equal(next.approvals.styleAndVoice.status, 'pending');
  assert.equal(next.history.at(-1).note.startsWith('style-review'), true);
});

test('a successful final render completes local delivery without publication approval', () => {
  const current = makeState('final-render');
  current.approvals.preview = approval('approved', '预览通过');
  const complete = transitionRender(current, 'render', {
    final: 'dist/test-film/final.mp4',
    report: 'dist/test-film/report.json',
    contactSheet: 'dist/test-film/contact-sheet.jpg',
    validationReport: 'dist/test-film/validation-report.json',
  });
  assert.equal(complete.stage, 'complete');
  assert.equal(getStageControl(complete).mode, 'complete');
  assert.equal(complete.approvals.publish.status, 'pending');

  const publishRecorded = transitionProduction(complete, 'approve-publish', {
    note: '用户另行确认外部发布',
  });
  assert.equal(publishRecorded.stage, 'complete');
  assert.equal(publishRecorded.approvals.publish.status, 'approved');
});

test('preview approval and both render modes reject unfinished work items', () => {
  const review = makeState('human-review');
  review.artifacts.preview = 'dist/test-film/preview.mp4';
  review.workItems = [
    {
      id: 'directing-revision-scene-02',
      label: '重新验证导演重编镜头 scene-02',
      status: 'pending',
      updatedAt: review.updatedAt,
      artifact: 'projects/test-film/directing-revision.json',
      note: '按新 storyboard 同步 project.json 执行树并重新验证。',
    },
  ];
  assert.throws(
    () =>
      transitionProduction(review, 'approve-preview', {
        note: '预览通过',
      }),
    /directing-revision-scene-02\(pending\)/,
  );

  const preview = makeState('preview');
  preview.workItems = structuredClone(review.workItems);
  assert.throws(
    () =>
      transitionRender(preview, 'preview', {
        preview: 'dist/test-film/preview.mp4',
      }),
    /render-preview 不能在工作项未完成时继续/,
  );

  const final = makeState('final-render');
  final.approvals.preview = approval('approved', '预览通过');
  final.workItems = structuredClone(review.workItems);
  assert.throws(
    () =>
      transitionRender(final, 'render', {
        final: 'dist/test-film/final.mp4',
      }),
    /render-final 不能在工作项未完成时继续/,
  );
});

test('render entrypoint checks the production gate before sync and audio work', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'scripts', 'project-render.mjs'),
    'utf8',
  );
  const gate = source.indexOf('await assertRenderAllowed(slug, mode);');
  const sync = source.indexOf("await runInherited(process.execPath, ['scripts/project-sync.mjs', slug]);");
  const audio = source.indexOf("'scripts/project-audio-preflight.mjs'");
  assert.ok(gate >= 0);
  assert.ok(sync > gate);
  assert.ok(audio > gate);
});

test('a tool-only image result remains an automatic production checkpoint', () => {
  const current = makeState('asset-production');
  const started = transitionWorkItem(current, 'background-01', {
    status: 'in-progress',
    label: '第一幕背景',
    at: '2026-07-16T00:01:00.000Z',
  });
  const generated = transitionWorkItem(started, 'background-01', {
    status: 'completed',
    artifact: 'public/projects/test-film/assets/plates/01-bg.png',
    at: '2026-07-16T00:02:00.000Z',
  });

  const control = getStageControl(generated);
  assert.equal(control.mode, 'auto-continue');
  assert.equal(control.mayEndTurn, false);
  assert.equal(control.workItems.counts.completed, 1);
  assert.equal(control.workItems.active.length, 0);
  assert.match(formatProduction(generated), /AUTO-CONTINUE · 无需用户操作/);
});

test('blocked work items require an exact reason and remain resumable', () => {
  const current = makeState('asset-production');
  assert.throws(
    () =>
      transitionWorkItem(current, 'narration-01', {
        status: 'blocked',
      }),
    /必须记录具体阻塞原因/,
  );
  const blocked = transitionWorkItem(current, 'narration-01', {
    status: 'blocked',
    label: '第一幕旁白',
    note: '语音提供方需要重新授权',
  });
  assert.deepEqual(getStageControl(blocked).workItems.active[0], {
    id: 'narration-01',
    label: '第一幕旁白',
    status: 'blocked',
    artifact: null,
    note: '语音提供方需要重新授权',
  });
});

test('human approval still requires an attributable note', () => {
  const state = makeState('style-review');
  assert.throws(
    () => transitionProduction(state, 'approve-style-voice'),
    /必须用 --note 记录人的明确决定/,
  );
});

test('review synchronization is idempotent and preserves human feedback', () => {
  const state = makeState('human-review');
  state.approvals.preview = approval('changes-requested', '第二幕节奏放慢');
  const existing = '# 验收记录：测试片\n\n## 人工反馈与修改记录\n\n- 保留现有意见\n';
  const merged = mergeReviewDocument(existing, state);
  const mergedAgain = mergeReviewDocument(merged, state);

  assert.equal(mergedAgain, merged);
  assert.match(merged, /预览片：需修改（第二幕节奏放慢/);
  assert.match(merged, /保留现有意见/);
  assert.equal((merged.match(/production-state:start/g) ?? []).length, 1);
  assert.equal((merged.match(/production-state:end/g) ?? []).length, 1);
  assert.match(renderReviewSection(state), /唯一当前状态/);
});
