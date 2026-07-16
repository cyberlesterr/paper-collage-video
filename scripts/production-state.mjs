import path from 'node:path';
import {
  ROOT,
  assertSlug,
  projectPaths,
  readJson,
  writeJson,
} from './project-lib.mjs';

export const PRODUCTION_STAGES = [
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

const ARTIFACT_KEYS = [
  'brief',
  'project',
  'prompts',
  'review',
  'validationReport',
  'preview',
  'final',
  'report',
  'contactSheet',
];
const REQUIRED_ARTIFACT_KEYS = new Set(['brief', 'project', 'prompts', 'review']);

const APPROVAL_STATUSES = ['pending', 'approved', 'changes-requested'];
const HUMAN_DECISION_ACTIONS = new Set([
  'approve-concept',
  'request-concept-revision',
  'approve-style-voice',
  'request-style-voice-revision',
  'approve-preview',
  'request-preview-revision',
  'approve-publish',
]);

const nextActionByStage = {
  brief: '完善 brief.md，再记录 brief-ready',
  'concept-review': '向人展示文案、分镜和素材清单；确认后记录 approve-concept',
  'style-review': '展示一张风格样张和虚构音色；确认后记录 approve-style-voice',
  'asset-production': '生产素材与旁白、同步时长并通过校验；然后记录 assets-ready',
  preview: '运行 project:preview',
  'human-review': '等待人审预览；确认后记录 approve-preview，或记录 request-preview-revision',
  'final-render': '运行 project:render',
  'publish-approval': '等待人做发布判断；明确批准后才记录 approve-publish',
  complete: '流程已完成；系统仍不得自动发布',
};

const clone = (value) => JSON.parse(JSON.stringify(value));

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
        `缺少 projects/${slug}/production.json；请迁移旧项目或重新运行 project:new。`,
      );
    }
    throw error;
  }
  const issues = validateProductionState(state, slug);
  if (issues.length > 0) {
    throw new Error(`production.json 无效：${issues.join('；')}`);
  }
  return {paths, state};
};

export const formatProduction = (state) => {
  const lines = [
    `${state.slug}: ${state.stage}`,
    `下一步：${nextActionByStage[state.stage]}`,
    '审批：',
  ];
  for (const key of APPROVAL_KEYS) {
    const approval = state.approvals[key];
    const note = approval.note ? ` · ${approval.note}` : '';
    lines.push(`  ${key}: ${approval.status}${note}`);
  }
  const artifacts = Object.entries(state.artifacts)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `  ${key}: ${value}`);
  if (artifacts.length > 0) lines.push('产物：', ...artifacts);
  return lines.join('\n');
};

export const transitionProduction = (current, action, options = {}) => {
  const state = clone(current);
  const at = options.at ?? new Date().toISOString();
  const note = (options.note ?? '').trim();
  if (HUMAN_DECISION_ACTIONS.has(action) && !note) {
    throw new Error(`动作 ${action} 必须用 --note 记录人的明确决定。`);
  }

  switch (action) {
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
        ['human-review', 'final-render', 'publish-approval'],
        action,
      );
      setApproval(state, 'preview', 'changes-requested', at, note);
      resetApproval(state, 'publish');
      state.stage = 'asset-production';
      break;
    case 'approve-publish':
      assertStage(state, ['publish-approval'], action);
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
    state.stage = 'publish-approval';
    resetApproval(state, 'publish');
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
  return state;
};
