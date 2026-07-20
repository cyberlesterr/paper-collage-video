import path from 'node:path';
import fs from 'node:fs/promises';
import {
  ROOT,
  assertSlug,
  projectPaths,
  readJson,
  writeJson,
} from './project-lib.mjs';

export const PRODUCTION_STAGES = [
  'capability-review',
  'brief',
  'concept-review',
  'style-review',
  'asset-production',
  'preview',
  'human-review',
  'final-render',
  'publish-approval',
  'complete',
];

export const APPROVAL_KEYS = [
  'concept',
  'styleAndVoice',
  'preview',
  'publish',
];

export const HUMAN_APPROVAL_STAGES = new Set([
  'concept-review',
  'style-review',
  'human-review',
]);

export const HUMAN_GATE_STAGES = new Set([
  'capability-review',
  ...HUMAN_APPROVAL_STAGES,
]);

export const WORK_ITEM_STATUSES = [
  'pending',
  'in-progress',
  'completed',
  'blocked',
];

const ARTIFACT_KEYS = [
  'brief',
  'project',
  'storyboard',
  'prompts',
  'review',
  'validationReport',
  'preview',
  'final',
  'report',
  'contactSheet',
];
const REQUIRED_ARTIFACT_KEYS = new Set(['brief', 'project', 'storyboard', 'prompts', 'review']);

const APPROVAL_STATUSES = ['pending', 'approved', 'changes-requested'];
const HUMAN_DECISION_ACTIONS = new Set([
  'capabilities-ready',
  'approve-concept',
  'request-concept-revision',
  'approve-style-voice',
  'request-style-voice-revision',
  'approve-preview',
  'request-preview-revision',
  'approve-publish',
]);

const nextActionByStage = {
  'capability-review':
    '准备概念、故事板、制作档位与 provider 方案；请人一次确认后直接进入风格样张',
  brief: '完善 brief.md，运行 project:plan 并锁定 storyboard，再记录 brief-ready',
  'concept-review': '向人展示文案、分镜和素材清单；确认后记录 approve-concept',
  'style-review': '展示一张风格样张和虚构音色；确认后记录 approve-style-voice',
  'asset-production': '生产素材与旁白、同步时长并通过校验；然后记录 assets-ready',
  preview: '运行 project:preview',
  'human-review': '等待人审预览；确认后记录 approve-preview，或记录 request-preview-revision',
  'final-render': '运行 project:render',
  'publish-approval': '旧版兼容状态：本地成片已交付；外部发布仍需单独请求',
  complete: '流程已完成；系统仍不得自动发布',
};

const stageControlByStage = {
  'capability-review': {
    mode: 'wait-human',
    gate: 'providers',
    requiredDecision:
      '请一次确认概念、故事板、制作档位与 text/image/voice provider 方案，或给出修改意见。',
    expectedArtifacts: ['brief', 'plan', 'storyboard', 'providers'],
  },
  brief: {
    mode: 'auto-continue',
    expectedArtifacts: ['brief', 'plan', 'storyboard'],
    nextCommand: (slug) => `npm run project:storyboard -- ${slug} --input=<storyboard.json>`,
  },
  'concept-review': {
    mode: 'wait-human',
    gate: 'concept',
    requiredDecision: '请明确批准概念，或给出文案、分镜和事实修改意见。',
    expectedArtifacts: ['brief', 'storyboard'],
  },
  'style-review': {
    mode: 'wait-human',
    gate: 'styleAndVoice',
    requiredDecision: '请明确批准风格样张和虚构音色，或给出修改意见。',
    expectedArtifacts: ['styleSample', 'voiceAudition'],
  },
  'asset-production': {
    mode: 'auto-continue',
    expectedArtifacts: ['productionAssets', 'narration', 'project', 'validationReport'],
    nextCommand: (slug) =>
      `npm run project:checkpoint -- ${slug} <work-item> <status>`,
  },
  preview: {
    mode: 'auto-continue',
    expectedArtifacts: ['preview', 'report', 'contactSheet'],
    nextCommand: (slug) => `npm run project:preview -- ${slug}`,
  },
  'human-review': {
    mode: 'wait-human',
    gate: 'preview',
    requiredDecision: '请回复“预览通过”，或给出具体修改意见。',
    expectedArtifacts: ['preview', 'report', 'contactSheet'],
  },
  'final-render': {
    mode: 'auto-continue',
    expectedArtifacts: ['final', 'report', 'contactSheet'],
    nextCommand: (slug) => `npm run project:render -- ${slug}`,
  },
  'publish-approval': {
    mode: 'complete',
    expectedArtifacts: ['final', 'report', 'contactSheet', 'validationReport'],
  },
  complete: {
    mode: 'complete',
    expectedArtifacts: ['final', 'report', 'contactSheet', 'validationReport'],
  },
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const normalizeWorkItems = (state) => {
  if (!Array.isArray(state.workItems)) state.workItems = [];
  return state.workItems;
};

export const summarizeWorkItems = (state) => {
  const workItems = Array.isArray(state?.workItems) ? state.workItems : [];
  const counts = Object.fromEntries(
    WORK_ITEM_STATUSES.map((status) => [
      status,
      workItems.filter((item) => item.status === status).length,
    ]),
  );
  return {
    total: workItems.length,
    counts,
    active: workItems
      .filter((item) => ['in-progress', 'blocked'].includes(item.status))
      .map(({id, label, status, artifact, note}) => ({
        id,
        label,
        status,
        artifact,
        note,
      })),
  };
};

export const getStageControl = (state) => {
  const definition = stageControlByStage[state.stage];
  if (!definition) throw new Error(`未知 stage：${state.stage}`);
  const mode = definition.mode;
  return {
    mode,
    gate: definition.gate ?? null,
    mayEndTurn: mode !== 'auto-continue',
    requiresHumanDecision: mode === 'wait-human',
    requiredDecision: definition.requiredDecision ?? null,
    nextCommand:
      typeof definition.nextCommand === 'function'
        ? definition.nextCommand(state.slug)
        : null,
    expectedArtifacts: definition.expectedArtifacts,
    workItems: summarizeWorkItems(state),
  };
};

export const assessHandoff = (state, options = {}) => {
  const control = getStageControl(state);
  if (control.mode !== 'auto-continue') {
    return {allowed: true, reason: control.mode, control};
  }
  const blocker = (options.blocker ?? '').trim();
  const needsUser = (options.needsUser ?? '').trim();
  if (blocker && needsUser) {
    return {
      allowed: true,
      reason: 'explicit-blocker',
      blocker,
      needsUser,
      control,
    };
  }
  return {
    allowed: false,
    reason: 'auto-continue',
    message: `当前阶段不得结束回合；请继续执行：${control.nextCommand}`,
    control,
  };
};

export const summarizeResumeState = (state, plan = null, storyboard = null) => {
  const control = getStageControl(state);
  const remaining = (state.workItems ?? [])
    .filter(({status}) => status !== 'completed')
    .map(({id, label, status, artifact, note}) => ({
      id,
      label,
      status,
      artifact,
      note,
    }));
  const handoff = assessHandoff(state);
  const nextCommand =
    state.stage === 'asset-production'
      ? remaining.length === 0
        ? `npm run project:assets-ready -- ${state.slug}`
        : null
      : control.nextCommand;
  return {
    slug: state.slug,
    stage: state.stage,
    productionProfile: plan?.productionProfile ?? null,
    storyboard,
    control: {
      mode: control.mode,
      gate: control.gate,
      requiredDecision: control.requiredDecision,
      nextCommand,
      expectedArtifacts: control.expectedArtifacts,
      workItems: {
        counts: control.workItems.counts,
        remaining,
      },
    },
    handoff: {
      allowed: handoff.allowed,
      reason: handoff.reason,
    },
  };
};

const assertStage = (state, allowed, action) => {
  if (!allowed.includes(state.stage)) {
    throw new Error(
      `动作 ${action} 不能在 ${state.stage} 阶段执行；允许阶段：${allowed.join(', ')}。`,
    );
  }
};

const assertApproved = (state, key, action) => {
  if (state.approvals[key]?.status !== 'approved') {
    throw new Error(`动作 ${action} 需要 approvals.${key} 已获人工批准。`);
  }
};

const setApproval = (state, key, status, at, note) => {
  state.approvals[key] = {
    status,
    decidedAt: at,
    note,
  };
};

const resetApproval = (state, key) => {
  state.approvals[key] = {
    status: 'pending',
    decidedAt: null,
    note: '',
  };
};

export const validateProductionState = (state, expectedSlug) => {
  const issues = [];
  if (state?.schemaVersion !== 1) issues.push('schemaVersion 必须为 1');
  if (state?.slug !== expectedSlug) issues.push(`slug 必须为 ${expectedSlug}`);
  if (typeof state?.createdAt !== 'string') issues.push('createdAt 必须为字符串');
  if (typeof state?.updatedAt !== 'string') issues.push('updatedAt 必须为字符串');
  if (!PRODUCTION_STAGES.includes(state?.stage)) {
    issues.push(`未知 stage：${state?.stage}`);
  }
  for (const key of APPROVAL_KEYS) {
    const approval = state?.approvals?.[key];
    if (!APPROVAL_STATUSES.includes(approval?.status)) {
      issues.push(`approvals.${key}.status 无效`);
    }
    if (approval && typeof approval.note !== 'string') {
      issues.push(`approvals.${key}.note 必须为字符串`);
    }
    if (
      approval &&
      approval.decidedAt !== null &&
      typeof approval.decidedAt !== 'string'
    ) {
      issues.push(`approvals.${key}.decidedAt 必须为字符串或 null`);
    }
  }
  if (state?.workItems !== undefined && !Array.isArray(state.workItems)) {
    issues.push('workItems 必须为数组');
  } else {
    for (const [index, item] of (state?.workItems ?? []).entries()) {
      if (
        typeof item?.id !== 'string' ||
        !/^[a-z0-9][a-z0-9._-]*$/.test(item.id)
      ) {
        issues.push(`workItems[${index}].id 无效`);
      }
      if (typeof item?.label !== 'string' || !item.label) {
        issues.push(`workItems[${index}].label 必须为非空字符串`);
      }
      if (!WORK_ITEM_STATUSES.includes(item?.status)) {
        issues.push(`workItems[${index}].status 无效`);
      }
      if (typeof item?.updatedAt !== 'string') {
        issues.push(`workItems[${index}].updatedAt 必须为字符串`);
      }
      if (item?.artifact !== null && typeof item?.artifact !== 'string') {
        issues.push(`workItems[${index}].artifact 必须为字符串或 null`);
      }
      if (typeof item?.note !== 'string') {
        issues.push(`workItems[${index}].note 必须为字符串`);
      }
    }
    const ids = (state?.workItems ?? []).map(({id}) => id);
    if (new Set(ids).size !== ids.length) issues.push('workItems.id 不能重复');
  }
  if (!state?.artifacts || typeof state.artifacts !== 'object') {
    issues.push('缺少 artifacts');
  } else {
    for (const key of ARTIFACT_KEYS) {
      const value = state.artifacts[key];
      if (REQUIRED_ARTIFACT_KEYS.has(key) && !value) {
        issues.push(`artifacts.${key} 必须为非空字符串`);
      } else if (value !== null && typeof value !== 'string') {
        issues.push(`artifacts.${key} 必须为字符串或 null`);
      }
    }
  }
  if (!Array.isArray(state?.history) || state.history.length === 0) {
    issues.push('history 必须是非空数组');
  } else {
    for (const [index, entry] of state.history.entries()) {
      if (typeof entry?.at !== 'string' || typeof entry?.action !== 'string') {
        issues.push(`history[${index}] 缺少 at 或 action`);
      }
      if (!PRODUCTION_STAGES.includes(entry?.stage)) {
        issues.push(`history[${index}].stage 无效`);
      }
      if (typeof entry?.note !== 'string') {
        issues.push(`history[${index}].note 必须为字符串`);
      }
    }
  }
  return issues;
};

export const loadProduction = async (slug) => {
  assertSlug(slug);
  const paths = projectPaths(slug);
  let state;
  try {
    state = await readJson(paths.productionFile);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `缺少 projects/${slug}/production.json；请重新运行 project:new。`,
      );
    }
    throw error;
  }
  const issues = validateProductionState(state, slug);
  if (issues.length > 0) {
    throw new Error(`production.json 无效：${issues.join('；')}`);
  }
  normalizeWorkItems(state);
  return {paths, state};
};

export const formatProduction = (state) => {
  const control = getStageControl(state);
  const controlLabel = {
    'auto-continue': 'AUTO-CONTINUE · 无需用户操作',
    'wait-human': 'WAIT-HUMAN · 等待用户决定',
    complete: 'COMPLETE · 流程完成',
  }[control.mode];
  const lines = [
    `${state.slug}: ${state.stage}`,
    `控制：${controlLabel}`,
    `下一步：${nextActionByStage[state.stage]}`,
    '审批：',
  ];
  if (control.requiredDecision) {
    lines.splice(3, 0, `需要用户：${control.requiredDecision}`);
  }
  if (control.nextCommand) {
    lines.splice(control.requiredDecision ? 4 : 3, 0, `建议命令：${control.nextCommand}`);
  }
  for (const key of APPROVAL_KEYS) {
    const approval = state.approvals[key];
    const note = approval.note ? ` · ${approval.note}` : '';
    lines.push(`  ${key}: ${approval.status}${note}`);
  }
  const artifacts = Object.entries(state.artifacts)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `  ${key}: ${value}`);
  if (artifacts.length > 0) lines.push('产物：', ...artifacts);
  const progress = control.workItems;
  if (progress.total > 0) {
    lines.push(
      '工作项：',
      `  completed ${progress.counts.completed}/${progress.total} · in-progress ${progress.counts['in-progress']} · blocked ${progress.counts.blocked}`,
    );
    for (const item of progress.active) {
      const note = item.note ? ` · ${item.note}` : '';
      lines.push(`  ${item.id}: ${item.status}${note}`);
    }
  }
  return lines.join('\n');
};

export const transitionWorkItem = (current, id, options = {}) => {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id ?? '')) {
    throw new Error('工作项 id 只能包含小写字母、数字、点、下划线或连字符。');
  }
  const status = options.status;
  if (!WORK_ITEM_STATUSES.includes(status)) {
    throw new Error(`工作项状态必须是：${WORK_ITEM_STATUSES.join(', ')}。`);
  }
  const note = (options.note ?? '').trim();
  if (status === 'blocked' && !note) {
    throw new Error('blocked 工作项必须记录具体阻塞原因。');
  }

  const state = clone(current);
  const at = options.at ?? new Date().toISOString();
  const workItems = normalizeWorkItems(state);
  const index = workItems.findIndex((item) => item.id === id);
  const existing = index >= 0 ? workItems[index] : null;
  const item = {
    id,
    label: (options.label ?? existing?.label ?? id).trim(),
    status,
    updatedAt: at,
    artifact:
      options.artifact === undefined
        ? (existing?.artifact ?? null)
        : options.artifact || null,
    note,
  };
  if (!item.label) throw new Error('工作项 label 不能为空。');
  if (index >= 0) workItems[index] = item;
  else workItems.push(item);
  state.updatedAt = at;
  state.history.push({
    at,
    action: `work-item-${status}`,
    stage: state.stage,
    note: `${id}${note ? ` · ${note}` : ''}`,
  });
  return state;
};

const REVIEW_START = '<!-- production-state:start -->';
const REVIEW_END = '<!-- production-state:end -->';
const approvalLabels = {
  concept: '文案、分镜与事实',
  styleAndVoice: '风格样张与虚构音色',
  preview: '预览片',
  publish: '可选外部发布记录',
};
const approvalStatusLabels = {
  pending: '待确认',
  approved: '已通过',
  'changes-requested': '需修改',
};

export const renderReviewSection = (state) => {
  const lines = [
    REVIEW_START,
    '## 当前审批状态（由 production.json 自动同步）',
    '',
    '> 本节是唯一当前状态；人工反馈写在下方，不要在其他文件重复维护审批状态。',
    '',
  ];
  for (const key of APPROVAL_KEYS) {
    const approval = state.approvals[key];
    const details = [approval.note, approval.decidedAt]
      .filter(Boolean)
      .join(' · ');
    lines.push(
      `- ${approvalLabels[key]}：${approvalStatusLabels[approval.status]}${details ? `（${details}）` : ''}`,
    );
  }
  const progress = summarizeWorkItems(state);
  if (progress.total > 0) {
    lines.push(
      `- 工作项：${progress.counts.completed}/${progress.total} 已完成，${progress.counts['in-progress']} 进行中，${progress.counts.blocked} 阻塞`,
    );
  }
  lines.push('', REVIEW_END);
  return lines.join('\n');
};

export const mergeReviewDocument = (existing, state) => {
  const section = renderReviewSection(state);
  const start = existing.indexOf(REVIEW_START);
  const end = existing.indexOf(REVIEW_END);
  if (start >= 0 && end >= start) {
    return `${existing.slice(0, start)}${section}${existing.slice(
      end + REVIEW_END.length,
    )}`;
  }
  const newline = existing.indexOf('\n');
  if (newline < 0) return `${existing}\n\n${section}\n`;
  return `${existing.slice(0, newline + 1)}\n${section}\n${existing.slice(
    newline + 1,
  )}`;
};

export const syncReviewFromProduction = async (slug, state) => {
  const {reviewFile} = projectPaths(slug);
  let existing;
  try {
    existing = await fs.readFile(reviewFile, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    existing = `# 验收记录：${slug}\n\n## 人工反馈与修改记录\n\n- 暂无\n`;
  }
  const merged = mergeReviewDocument(existing, state);
  await fs.writeFile(reviewFile, merged.endsWith('\n') ? merged : `${merged}\n`, 'utf8');
};

const syncReviewBestEffort = async (slug, state) => {
  try {
    await syncReviewFromProduction(slug, state);
  } catch (error) {
    console.warn(
      `⚠ production.json 已更新，但 review.md 自动同步失败：${error.message}。可运行 project:review-sync 重试。`,
    );
  }
};

export const transitionProduction = (current, action, options = {}) => {
  const state = clone(current);
  const at = options.at ?? new Date().toISOString();
  const note = (options.note ?? '').trim();
  if (HUMAN_DECISION_ACTIONS.has(action) && !note) {
    throw new Error(`动作 ${action} 必须用 --note 记录人的明确决定。`);
  }

  switch (action) {
    case 'capabilities-ready':
      assertStage(state, ['capability-review'], action);
      state.stage = 'brief';
      break;
    case 'brief-ready':
      assertStage(state, ['brief'], action);
      state.stage = 'concept-review';
      break;
    case 'approve-concept':
      assertStage(state, ['concept-review'], action);
      setApproval(state, 'concept', 'approved', at, note);
      state.stage = 'style-review';
      break;
    case 'request-concept-revision':
      assertStage(state, ['concept-review', 'style-review'], action);
      setApproval(state, 'concept', 'changes-requested', at, note);
      resetApproval(state, 'styleAndVoice');
      state.stage = 'concept-review';
      break;
    case 'approve-style-voice':
      assertStage(state, ['style-review'], action);
      assertApproved(state, 'concept', action);
      setApproval(state, 'styleAndVoice', 'approved', at, note);
      state.stage = 'asset-production';
      break;
    case 'request-style-voice-revision':
      assertStage(state, ['style-review'], action);
      setApproval(state, 'styleAndVoice', 'changes-requested', at, note);
      break;
    case 'assets-ready':
      assertStage(state, ['asset-production'], action);
      assertApproved(state, 'concept', action);
      assertApproved(state, 'styleAndVoice', action);
      state.stage = 'preview';
      break;
    case 'approve-preview':
      assertStage(state, ['human-review'], action);
      assertApproved(state, 'concept', action);
      assertApproved(state, 'styleAndVoice', action);
      if (!state.artifacts.preview) {
        throw new Error('approve-preview 需要已经成功记录 preview.mp4。');
      }
      setApproval(state, 'preview', 'approved', at, note);
      state.stage = 'final-render';
      break;
    case 'request-preview-revision':
      assertStage(
        state,
        ['human-review', 'final-render', 'publish-approval', 'complete'],
        action,
      );
      setApproval(state, 'preview', 'changes-requested', at, note);
      resetApproval(state, 'publish');
      state.stage = 'asset-production';
      break;
    case 'approve-publish':
      assertStage(state, ['publish-approval', 'complete'], action);
      assertApproved(state, 'preview', action);
      if (!state.artifacts.final) {
        throw new Error('approve-publish 需要已经成功记录 final.mp4。');
      }
      setApproval(state, 'publish', 'approved', at, note);
      state.stage = 'complete';
      break;
    default:
      throw new Error(`未知生产动作：${action}`);
  }

  if (options.artifacts) {
    Object.assign(state.artifacts, options.artifacts);
  }
  state.updatedAt = at;
  state.history.push({at, action, stage: state.stage, note});
  return state;
};

export const advanceProduction = async (slug, action, options = {}) => {
  const {paths, state: current} = await loadProduction(slug);
  const state = transitionProduction(current, action, options);
  await writeJson(paths.productionFile, state);
  await syncReviewBestEffort(slug, state);
  return state;
};

export const advanceWorkItem = async (slug, id, options = {}) => {
  const {paths, state: current} = await loadProduction(slug);
  const state = transitionWorkItem(current, id, options);
  await writeJson(paths.productionFile, state);
  await syncReviewBestEffort(slug, state);
  return state;
};

export const assertRenderAllowed = async (slug, mode) => {
  const {state} = await loadProduction(slug);
  assertApproved(state, 'concept', `render-${mode}`);
  assertApproved(state, 'styleAndVoice', `render-${mode}`);
  const stageRank = PRODUCTION_STAGES.indexOf(state.stage);
  if (mode === 'preview') {
    const minimum = PRODUCTION_STAGES.indexOf('preview');
    if (stageRank < minimum) {
      throw new Error('预览渲染前必须记录 assets-ready。');
    }
  } else {
    assertApproved(state, 'preview', 'render-final');
    const minimum = PRODUCTION_STAGES.indexOf('final-render');
    if (stageRank < minimum) {
      throw new Error('正式渲染前必须获得预览人工批准。');
    }
  }
  return state;
};

export const transitionRender = (current, mode, artifacts, options = {}) => {
  if (!['preview', 'render'].includes(mode)) {
    throw new Error(`未知渲染模式：${mode}`);
  }
  const state = clone(current);
  const at = options.at ?? new Date().toISOString();
  Object.assign(state.artifacts, artifacts);
  if (mode === 'preview' && state.stage === 'preview') {
    state.stage = 'human-review';
    resetApproval(state, 'preview');
  }
  if (mode === 'render' && state.stage === 'final-render') {
    state.stage = 'complete';
  }
  const action = mode === 'preview' ? 'preview-rendered' : 'final-rendered';
  const artifact =
    artifacts[mode === 'preview' ? 'preview' : 'final'] ?? '';
  state.updatedAt = at;
  state.history.push({at, action, stage: state.stage, note: artifact});
  return state;
};

export const recordRender = async (slug, mode) => {
  const {paths, state: current} = await loadProduction(slug);
  const artifact = path.relative(
    ROOT,
    path.join(paths.distDirectory, mode === 'preview' ? 'preview.mp4' : 'final.mp4'),
  );
  const artifacts = {
    [mode === 'preview' ? 'preview' : 'final']: artifact,
    validationReport: path.relative(ROOT, paths.validationReport),
    report: path.relative(ROOT, path.join(paths.distDirectory, 'report.json')),
    contactSheet: path.relative(
      ROOT,
      path.join(paths.distDirectory, 'contact-sheet.jpg'),
    ),
  };
  const state = transitionRender(current, mode, artifacts);
  await writeJson(paths.productionFile, state);
  await syncReviewBestEffort(slug, state);
  return state;
};
