import path from 'node:path';
import fs from 'node:fs/promises';
import {
  ROOT,
  assertSlug,
  projectPaths,
  readJson,
  writeJson,
} from './project-lib.mjs';
import {assertAssetsReadySealCurrent} from './assets-ready-seal-lib.mjs';

export const PRODUCTION_STAGES = [
  'capability-review',
  'brief',
  'concept-review',
  'style-review',
  'asset-production',
  'preview',
  'human-review',
  'final-render',
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
  'motionLanguageCard',
  'motionApproval',
  'visualBlueprint',
  'visualBlueprintReviewRequest',
  'visualBlueprintReviewReceipt',
  'visualBlueprintApproval',
  'validationReport',
  'assetsReadySeal',
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
  'approve-visual-blueprint',
  'request-visual-blueprint-revision',
  'request-style-voice-revision',
  'approve-preview',
  'request-preview-revision',
  'approve-image-budget-increase',
  'approve-publish',
]);

const nextActionByStage = {
  'capability-review':
    '先完成画幅/视觉风格/视差 intake；再比较三档故事与制作方案，并一次确认档位、预算上限和 provider',
  brief: '完善 brief.md，运行 project:plan 并锁定 storyboard，再记录 brief-ready',
  'concept-review': '向人展示文案、分镜和素材清单；确认后记录 approve-concept',
  'style-review': '展示故事专属风格样张、同源全片视觉蓝图、虚构音色与动作语言；等待当前人工回执后运行 project:visual-review',
  'asset-production': '生产素材与旁白、同步时长并通过校验；然后记录 assets-ready',
  preview: '运行 project:preview',
  'human-review': '等待人审预览；确认后记录 approve-preview，或记录 request-preview-revision',
  'final-render': '运行 project:render',
  complete: '流程已完成；系统仍不得自动发布',
};

const stageControlByStage = {
  'capability-review': {
    mode: 'wait-human',
    gate: 'intake-or-scenario',
    requiredDecision:
      '若 intake 未确认，请选择画幅、视觉风格和视差偏好；否则请一次确认 scenario、制作档位、精确图片上限与当前故事板要求的 provider（sound 仅在存在 soundCue 时需要）。',
    expectedArtifacts: ['intake', 'planningScenarios', 'brief', 'plan', 'storyboard', 'providers'],
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
    requiredDecision: '请观看故事专属风格样张、同源低清全片、每幕开头/中间/结尾和动态片段；一次批准视觉蓝图、动作语言与虚构音色，或直接指出不满意处。',
    expectedArtifacts: ['storySpecificStyleSample', 'visualBlueprint', 'visualBlueprintReviewRequest', 'motionLanguageCard', 'voiceAudition'],
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

const unresolvedWorkItems = (state) =>
  (state.workItems ?? []).filter(({status}) => status !== 'completed');

const isDirectingRevisionWorkItem = ({id}) =>
  id.startsWith('directing-revision-');

const formatUnresolvedWorkItems = (items) =>
  items.map(({id, status}) => `${id}(${status})`).join(', ');

const renderActionFor = (mode) =>
  mode === 'preview' ? 'render-preview' : 'render-final';

const assertNoUnresolvedWorkItems = (
  state,
  action,
  {allowValidatedDirectingRevision = false} = {},
) => {
  const unresolved = unresolvedWorkItems(state);
  const blocking = allowValidatedDirectingRevision
    ? unresolved.filter(
        (item) =>
          !isDirectingRevisionWorkItem(item) || item.status === 'blocked',
      )
    : unresolved;
  if (blocking.length === 0) return;
  throw new Error(
    `${action} 不能在工作项未完成时继续：${formatUnresolvedWorkItems(blocking)}。` +
      '请先用 project:checkpoint 完成或解除这些工作项；导演修订同步项由当前 project:assets-ready seal 验证后自动结清。',
  );
};

const settleValidatedDirectingRevisionWorkItems = (state, at) => {
  assertNoUnresolvedWorkItems(state, 'assets-ready', {
    allowValidatedDirectingRevision: true,
  });
  for (const item of normalizeWorkItems(state)) {
    if (
      item.status === 'completed' ||
      !isDirectingRevisionWorkItem(item)
    ) {
      continue;
    }
    item.status = 'completed';
    item.updatedAt = at;
    item.artifact = state.artifacts.project;
    item.note =
      'satisfied-by-assets-ready · 当前 seal 已验证 storyboard 与 project 执行树同步。';
    state.history.push({
      at,
      action: 'work-item-completed',
      stage: state.stage,
      note: `${item.id} · ${item.note}`,
    });
  }
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

export const summarizeResumeState = (
  state,
  plan = null,
  storyboard = null,
  context = {},
) => {
  const control = getStageControl(state);
  let capabilityAutoContinue = false;
  if (state.stage === 'capability-review') {
    if (context.intake?.status !== 'confirmed') {
      control.gate = 'intake';
      control.requiredDecision =
        '请选择 16:9 / 9:16、当前内置目录中的一种视觉风格，以及分层视差偏好。';
      control.expectedArtifacts = ['styleCatalog', 'intake'];
    } else if (context.planningScenarios?.status !== 'ready') {
      capabilityAutoContinue = true;
      control.mode = 'auto-continue';
      control.mayEndTurn = false;
      control.requiresHumanDecision = false;
      control.gate = 'scenario-planning';
      control.requiredDecision = null;
      control.nextCommand =
        `npm run project:scenarios -- ${state.slug} --input=<scenarios.json> --json`;
      control.expectedArtifacts = ['intake', 'commonStory', 'planningScenarios'];
    } else {
      control.gate = 'scenario-profile-budget-providers';
      control.requiredDecision =
        '请在三档方案中选择一个，并一次确认对应的故事范围、制作档位、精确图片上限和当前故事板要求的 provider。';
      control.expectedArtifacts = [
        'planningScenarios',
        'brief',
        'plan',
        'storyboard',
        'providers',
      ];
    }
  }
  const remaining = (state.workItems ?? [])
    .filter(({status}) => status !== 'completed')
    .map(({id, label, status, artifact, note}) => ({
      id,
      label,
      status,
      artifact,
      note,
    }));
  const handoff = capabilityAutoContinue
    ? {allowed: false, reason: 'auto-continue'}
    : assessHandoff(state);
  const nextCommand =
    state.stage === 'asset-production'
      ? remaining.length === 0
        ? `npm run project:assets-ready -- ${state.slug}`
        : null
      : control.nextCommand;
  return {
    slug: state.slug,
    stage: state.stage,
    productionProfile:
      plan?.status === 'pending' ? null : plan?.productionProfile ?? null,
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

export const resolveAssetsReadyMode = (stage) => {
  if (stage === 'asset-production') return 'advance';
  if (['preview', 'human-review'].includes(stage)) return 'recheck';
  throw new Error(
    `project:assets-ready 只能在 asset-production、preview 或 human-review 阶段执行；当前为 ${stage}。`,
  );
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
      } else if (
        value !== undefined &&
        value !== null &&
        typeof value !== 'string'
      ) {
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

export const transitionDirectingRevision = (current, options = {}) => {
  const action = 'revise-preview-directing';
  const source = options.source ?? 'preview';
  if (!['style-review', 'preview', 'asset-production'].includes(source)) {
    throw new Error(`${action} 的来源必须是 style-review、preview 或 asset-production。`);
  }
  if (source === 'style-review') {
    assertStage(current, ['style-review'], action);
  } else {
    assertStage(current, ['asset-production'], action);
  }
  if (source === 'preview' && current.approvals?.preview?.status !== 'changes-requested') {
    throw new Error(`${action} 只能响应已记录的 request-preview-revision。`);
  }
  if (source === 'preview' && !(current.history ?? []).some((entry) => entry.action === 'request-preview-revision')) {
    throw new Error(`${action} 缺少 request-preview-revision 历史证据。`);
  }
  const changedSceneIds = [...new Set(options.changedSceneIds ?? [])];
  if (changedSceneIds.length === 0) {
    throw new Error(`${action} 必须至少包含一个实际改变的镜头。`);
  }

  const state = clone(current);
  const at = options.at ?? new Date().toISOString();
  const reportPath = (options.reportPath ?? '').trim();
  if (!reportPath) throw new Error(`${action} 必须记录 directing-revision 报告路径。`);
  assertApproved(state, 'concept', action);
  if (source !== 'style-review') assertApproved(state, 'styleAndVoice', action);

  for (const key of ['validationReport', 'assetsReadySeal', 'preview', 'final', 'report', 'contactSheet']) {
    state.artifacts[key] = null;
  }
  if (options.invalidateStyleProof) state.artifacts.styleProof = null;
  state.artifacts.directingRevision = reportPath;
  const workItems = normalizeWorkItems(state);
  for (const sceneId of changedSceneIds) {
    const id = `directing-revision-${sceneId}`;
    const next = {
      id,
      label: `重新验证导演重编镜头 ${sceneId}`,
      status: 'pending',
      updatedAt: at,
      artifact: reportPath,
      note: '执行树已由修订命令原子同步；重新生成并验证受影响的证明、质量和交付封印。',
    };
    const index = workItems.findIndex((item) => item.id === id);
    if (index >= 0) workItems[index] = next;
    else workItems.push(next);
  }
  state.updatedAt = at;
  state.history.push({
    at,
    action,
    stage: state.stage,
    note: `${source} · ${changedSceneIds.join(', ')} · ${reportPath}`,
  });
  return state;
};

const REVIEW_START = '<!-- production-state:start -->';
const REVIEW_END = '<!-- production-state:end -->';
const approvalLabels = {
  concept: '文案、分镜与事实',
  styleAndVoice: '同源视觉蓝图、全片动作语言与虚构音色',
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
      state.artifacts.motionApproval = null;
      state.artifacts.visualBlueprint = null;
      state.artifacts.visualBlueprintReviewRequest = null;
      state.artifacts.visualBlueprintReviewReceipt = null;
      state.artifacts.visualBlueprintApproval = null;
      state.stage = 'concept-review';
      break;
    case 'approve-style-voice':
      assertStage(state, ['style-review'], action);
      assertApproved(state, 'concept', action);
      setApproval(state, 'styleAndVoice', 'approved', at, note);
      state.stage = 'asset-production';
      break;
    case 'approve-visual-blueprint':
      assertStage(state, ['asset-production'], action);
      assertApproved(state, 'concept', action);
      assertApproved(state, 'styleAndVoice', action);
      break;
    case 'request-visual-blueprint-revision':
      assertStage(state, ['style-review', 'asset-production'], action);
      if (state.stage === 'style-review') {
        setApproval(state, 'styleAndVoice', 'changes-requested', at, note);
        state.artifacts.motionApproval = null;
      } else {
        assertApproved(state, 'styleAndVoice', action);
      }
      state.artifacts.visualBlueprintReviewReceipt = null;
      state.artifacts.visualBlueprintApproval = null;
      break;
    case 'request-style-voice-revision':
      assertStage(state, ['style-review'], action);
      setApproval(state, 'styleAndVoice', 'changes-requested', at, note);
      state.artifacts.motionApproval = null;
      state.artifacts.visualBlueprintReviewReceipt = null;
      state.artifacts.visualBlueprintApproval = null;
      break;
    case 'assets-ready':
      assertStage(state, ['asset-production'], action);
      assertApproved(state, 'concept', action);
      assertApproved(state, 'styleAndVoice', action);
      settleValidatedDirectingRevisionWorkItems(state, at);
      state.stage = 'preview';
      break;
    case 'approve-preview':
      assertStage(state, ['human-review'], action);
      assertApproved(state, 'concept', action);
      assertApproved(state, 'styleAndVoice', action);
      assertNoUnresolvedWorkItems(state, action);
      if (!state.artifacts.preview) {
        throw new Error('approve-preview 需要已经成功记录 preview.mp4。');
      }
      setApproval(state, 'preview', 'approved', at, note);
      state.stage = 'final-render';
      break;
    case 'request-preview-revision':
      assertStage(
        state,
        ['human-review', 'final-render', 'complete'],
        action,
      );
      setApproval(state, 'preview', 'changes-requested', at, note);
      resetApproval(state, 'publish');
      for (const key of ['validationReport', 'assetsReadySeal', 'preview', 'final', 'report', 'contactSheet']) {
        state.artifacts[key] = null;
      }
      state.stage = 'asset-production';
      break;
    case 'approve-image-budget-increase':
      assertStage(
        state,
        [
          'style-review',
          'asset-production',
          'preview',
          'human-review',
          'final-render',
          'complete',
        ],
        action,
      );
      assertApproved(state, 'concept', action);
      break;
    case 'approve-publish':
      assertStage(state, ['complete'], action);
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
  let resolvedOptions = options;
  if (action === 'assets-ready') {
    const {file} = await assertAssetsReadySealCurrent(slug);
    resolvedOptions = {
      ...options,
      artifacts: {
        ...(options.artifacts ?? {}),
        validationReport: path.relative(ROOT, paths.validationReport),
        assetsReadySeal: path.relative(ROOT, file),
      },
    };
  }
  const state = transitionProduction(current, action, resolvedOptions);
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

export const recordAssetsReadySeal = async (slug, artifacts) => {
  const {paths, state: current} = await loadProduction(slug);
  resolveAssetsReadyMode(current.stage);
  const state = clone(current);
  Object.assign(state.artifacts, artifacts);
  const at = new Date().toISOString();
  settleValidatedDirectingRevisionWorkItems(state, at);
  state.updatedAt = at;
  state.history.push({
    at,
    action: 'assets-ready-rechecked',
    stage: state.stage,
    note: artifacts.assetsReadySeal ?? '',
  });
  await writeJson(paths.productionFile, state);
  await syncReviewBestEffort(slug, state);
  return state;
};

export const recordMotionLanguageCard = async (slug, artifact) => {
  const {paths, state: current} = await loadProduction(slug);
  const state = clone(current);
  state.artifacts.motionLanguageCard = artifact;
  const at = new Date().toISOString();
  state.updatedAt = at;
  state.history.push({
    at,
    action: 'motion-language-compiled',
    stage: state.stage,
    note: artifact,
  });
  await writeJson(paths.productionFile, state);
  await syncReviewBestEffort(slug, state);
  return state;
};

export const recordVisualBlueprint = async (
  slug,
  artifact,
  {reviewRequest = null} = {},
) => {
  const {paths, state: current} = await loadProduction(slug);
  if (!['style-review', 'asset-production'].includes(current.stage)) {
    throw new Error(
      `视觉蓝图只能在 style-review 或已批准后的修订期记录；当前为 ${current.stage}。`,
    );
  }
  const state = clone(current);
  state.artifacts.visualBlueprint = artifact;
  state.artifacts.visualBlueprintReviewRequest = reviewRequest;
  state.artifacts.visualBlueprintReviewReceipt = null;
  state.artifacts.visualBlueprintApproval = null;
  const at = new Date().toISOString();
  state.updatedAt = at;
  state.history.push({
    at,
    action: 'visual-blueprint-rendered',
    stage: state.stage,
    note: artifact,
  });
  await writeJson(paths.productionFile, state);
  await syncReviewBestEffort(slug, state);
  return state;
};

export const assertRenderAllowed = async (slug, mode) => {
  const {state} = await loadProduction(slug);
  assertNoUnresolvedWorkItems(state, renderActionFor(mode));
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
  await assertAssetsReadySealCurrent(slug);
  return state;
};

export const transitionRender = (current, mode, artifacts, options = {}) => {
  if (!['preview', 'render'].includes(mode)) {
    throw new Error(`未知渲染模式：${mode}`);
  }
  const state = clone(current);
  assertNoUnresolvedWorkItems(state, renderActionFor(mode));
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
