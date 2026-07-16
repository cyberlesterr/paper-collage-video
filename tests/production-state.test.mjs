import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessHandoff,
  formatProduction,
  getStageControl,
  HUMAN_APPROVAL_STAGES,
  HUMAN_GATE_STAGES,
  mergeReviewDocument,
  PRODUCTION_STAGES,
  renderReviewSection,
  transitionProduction,
  transitionWorkItem,
} from '../scripts/production-state.mjs';

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
    prompts: 'projects/test-film/prompts.json',
    review: 'projects/test-film/review.md',
    validationReport: null,
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

test('capability setup and the four approvals are the only human wait stages', () => {
  const waitingStages = PRODUCTION_STAGES.filter(
    (stage) => getStageControl(makeState(stage)).mode === 'wait-human',
  );
  assert.deepEqual(waitingStages, [
    'capability-review',
    'concept-review',
    'style-review',
    'human-review',
    'publish-approval',
  ]);
  assert.deepEqual(waitingStages, [...HUMAN_GATE_STAGES]);
  assert.deepEqual([...HUMAN_APPROVAL_STAGES], [
    'concept-review',
    'style-review',
    'human-review',
    'publish-approval',
  ]);
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

test('review synchronization removes an untouched legacy status template', () => {
  const state = makeState('publish-approval');
  const legacy = `# 验收记录：旧模板

## 文案和镜头

- 状态：待确认
- 意见：

## 风格和旁白

- 状态：待确认
- 意见：

## 样片

- 状态：待生成
- 意见：

## 最终批准

- 内容准确性：待确认
- 授权和合规：待确认
- 发布批准：待确认
`;
  const migrated = mergeReviewDocument(legacy, state);
  assert.doesNotMatch(migrated, /## 文案和镜头/);
  assert.match(migrated, /## 人工反馈与修改记录/);
  assert.match(migrated, /当前审批状态/);
});
