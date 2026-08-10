import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  assertAssetManifest,
  createAssetRecordId,
  transactAssetManifest,
} from './asset-manifest-lib.mjs';
import {ROOT, SLUG_PATTERN, fileExists, probeMedia, readJson, writeJson} from './project-lib.mjs';
import {
  SEMANTIC_RISK_CLASSES,
  assertRequestSemanticContracts,
  requiredChecksForSemanticBinding,
} from './semantic-contract-lib.mjs';
import {
  assertRecoverableGenerationAttempt,
  assertReservedGenerationAttempt,
  closeGenerationAttempt,
  generationRequestFingerprint,
  generationAttemptsPath,
  isQuotaConsumingImageRequest,
  normalizeAttemptModel,
} from './generation-attempt-lib.mjs';
import {
  assertObservedKeyPlaneSet,
  inspectObservedKeyPlanePixels,
  OBSERVED_KEY_PLANE_MODE,
  OBSERVED_KEY_PLANE_POLICY_ID,
  observedKeyPlanePolicyFingerprint,
  validateObservedKeyPlaneDeclaration,
} from './observed-key-plane-lib.mjs';
import {
  inspectStateAnchorRegistration,
} from './state-sheet-lib.mjs';
import {
  styleProfileBinding,
  validateStyleProfileBinding,
} from './style-catalog-lib.mjs';
import {
  canonicalContainerPackageBindingMatchesPlan,
  validateCanonicalContainerIntent,
} from './container-source-plan-lib.mjs';
import {assertWorldTopologyBinding} from './world-topology-proof-lib.mjs';
import {assertScenarioRootRequest} from './provider-root-plan-lib.mjs';

export const CORE_PROVIDER_CAPABILITIES = ['text', 'image', 'voice'];
export const OPTIONAL_PROVIDER_CAPABILITIES = ['sound'];
export const PROVIDER_CAPABILITIES = [
  ...CORE_PROVIDER_CAPABILITIES,
  ...OPTIONAL_PROVIDER_CAPABILITIES,
];
export const PROVIDER_ADAPTERS = ['host', 'command', 'manual'];
export const PROVIDER_SCOPES = ['project', 'workspace'];
const IMAGE_QUALITY_KINDS = [
  'background',
  'environment',
  'character',
  'prop',
  'decorative',
  'character-sheet',
  'style-sample',
  'mechanism',
  'diagram',
  'image',
];
const IMAGE_QUALITY_CHECKS = [
  'no-text',
  'no-watermark',
  'no-people',
  'safe-area-clear',
  'style-consistent',
  'style-profile-conformant',
  'subject-complete',
  'identity-consistent',
  'identity-distinct-within-frame',
  'identity-family-consistent',
  'cross-scene-identity-continuity',
  'cell-separation',
  'untargeted-cells-unchanged',
  'background-uniform',
  'edge-clean',
  'silhouette-fidelity',
  'negative-space-clean',
  'background-leak-free',
  'mechanism-complete',
  'load-path-readable',
  'physical-plausibility',
  'reference-conformant',
  'diagram-edge-clean',
  'small-text-legible',
  'no-procedural-noise-on-semantic-lines',
  'clean-plate-clear',
  'canonical-frame-only',
  'container-content-only',
  'container-state-separation',
  'container-fill-progression',
];
const PROVIDER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const CANONICAL_CONTAINER_PROMPT_DIRECTIVES = {
  'clean-plate': 'CLEAN_PLATE_ONLY_NO_CONTAINER',
  'canonical-frame': 'CANONICAL_FRAME_ONLY_NO_CONTENTS',
  'content-state-sheet':
    'CONTENT_STATES_ONLY_NO_CONTAINER_FRAME_OR_EXTRA_SURFACE',
};

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const validStateAnchors = (anchors) =>
  Array.isArray(anchors) &&
  anchors.length > 0 &&
  new Set(anchors.map(({id}) => id)).size === anchors.length &&
  anchors.every(
    ({id, x, y}) =>
      typeof id === 'string' &&
      id.trim().length > 0 &&
      Number.isFinite(x) &&
      x >= 0 &&
      x <= 1 &&
      Number.isFinite(y) &&
      y >= 0 &&
      y <= 1,
  );

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
};

export const createRequestFingerprint = ({request, providerId, model}) => {
  const reusableRequest = {
    capability: request.capability,
    prompt: request.prompt ?? null,
    text: request.text ?? null,
    voiceId: request.voiceId ?? null,
    model: model ?? request.model ?? null,
    settings: request.settings ?? {},
    quality: request.quality ?? null,
    styleProfileBinding: request.styleProfileBinding ?? null,
    compositionBinding: request.compositionBinding ?? null,
    stateBinding: request.stateBinding ?? null,
    stateSheetBinding: request.stateSheetBinding ?? null,
    stateSheetRecoveryBinding: request.stateSheetRecoveryBinding ?? null,
    layerPackageBinding: request.layerPackageBinding ?? null,
    containerPackageBinding: request.containerPackageBinding ?? null,
    semanticBinding: request.semanticBinding ?? null,
    timingBinding: request.timingBinding ?? null,
    soundBinding: request.soundBinding ?? null,
    outputSurface: request.outputSurface ?? null,
    providerSource: request.providerSource ?? null,
    worldTopologyBinding: request.worldTopologyBinding ?? null,
    scenarioRootBinding: request.scenarioRootBinding ?? null,
    providerId,
  };
  return createHash('sha256')
    .update(JSON.stringify(stableValue(reusableRequest)))
    .digest('hex');
};

export const deepMerge = (base, overlay) => {
  if (!isPlainObject(base) || !isPlainObject(overlay)) return overlay;
  const merged = {...base};
  for (const [key, value] of Object.entries(overlay)) {
    merged[key] =
      isPlainObject(value) && isPlainObject(base[key])
        ? deepMerge(base[key], value)
        : value;
  }
  return merged;
};

const readOptionalJson = async (file) =>
  (await fileExists(file)) ? readJson(file) : null;

export const validateProviderConfig = (config) => {
  const issues = [];
  const add = (level, code, message, location) =>
    issues.push({level, code, message, location});

  if (config?.schemaVersion !== 1) {
    add('error', 'schema-version', 'provider schemaVersion 必须为 1。', 'schemaVersion');
  }
  const configuredCapabilities = [
    ...CORE_PROVIDER_CAPABILITIES,
    ...OPTIONAL_PROVIDER_CAPABILITIES.filter(
      (capability) => config?.capabilities?.[capability],
    ),
  ];
  for (const capability of configuredCapabilities) {
    const definition = config?.capabilities?.[capability];
    if (!definition) {
      add('error', 'capability-missing', `缺少 ${capability} provider 配置。`, `capabilities.${capability}`);
      continue;
    }
    const providers = definition.providers;
    if (!isPlainObject(providers) || Object.keys(providers).length === 0) {
      add('error', 'providers-empty', `${capability} 至少需要一个 provider。`, `capabilities.${capability}.providers`);
      continue;
    }
    if (!providers[definition.defaultProvider]) {
      add(
        'error',
        'default-provider-missing',
        `${capability} 默认 provider ${definition.defaultProvider ?? '(empty)'} 不存在。`,
        `capabilities.${capability}.defaultProvider`,
      );
    }
    const selection = definition.selection;
    if (selection !== undefined) {
      const location = `capabilities.${capability}.selection`;
      if (
        selection?.status !== 'confirmed' ||
        !selection.provider ||
        typeof selection.confirmedAt !== 'string' ||
        !PROVIDER_SCOPES.includes(selection.scope) ||
        !selection.note
      ) {
        add(
          'error',
          'provider-selection',
          'selection 必须记录 confirmed 状态、provider、时间、scope 和人的决定。',
          location,
        );
      } else if (!providers[selection.provider]) {
        add(
          'error',
          'selected-provider-missing',
          `已确认的 provider 不存在：${selection.provider}。`,
          `${location}.provider`,
        );
      } else if (selection.provider !== definition.defaultProvider) {
        add(
          'error',
          'selected-provider-mismatch',
          `selection.provider ${selection.provider} 与 defaultProvider ${definition.defaultProvider} 不一致。`,
          location,
        );
      }
    }
    for (const [providerId, provider] of Object.entries(providers)) {
      const location = `capabilities.${capability}.providers.${providerId}`;
      const secretFields = Object.keys(provider ?? {}).filter((key) =>
        /api.?key|token|secret|password|authorization/i.test(key),
      );
      if (secretFields.length) {
        add(
          'error',
          'provider-secret',
          `不要在 JSON 保存密钥字段：${secretFields.join(', ')}；请改用 requiredEnv。`,
          location,
        );
      }
      if (!provider?.label || typeof provider.label !== 'string') {
        add('error', 'provider-label', 'provider 必须有 label。', `${location}.label`);
      }
      if (!PROVIDER_ADAPTERS.includes(provider?.adapter)) {
        add('error', 'provider-adapter', `未知 adapter：${provider?.adapter}`, `${location}.adapter`);
      }
      if (
        provider?.requiredEnv !== undefined &&
        (!Array.isArray(provider.requiredEnv) ||
          provider.requiredEnv.some(
            (name) => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name),
          ))
      ) {
        add('error', 'provider-env', 'requiredEnv 只能包含环境变量名。', `${location}.requiredEnv`);
      }
      if (provider?.invocation !== undefined) {
        const invocation = provider.invocation;
        if (
          !isPlainObject(invocation) ||
          ['providerValue', 'modelValue'].some(
            (key) => invocation[key] !== undefined &&
              (typeof invocation[key] !== 'string' || !invocation[key].trim()),
          ) ||
          (invocation.reportedModelAliases !== undefined &&
            (!Array.isArray(invocation.reportedModelAliases) ||
              invocation.reportedModelAliases.some(
                (alias) => typeof alias !== 'string' || !alias.trim(),
              )))
        ) {
          add(
            'error',
            'provider-invocation',
            'invocation 的 provider/model 映射和 reportedModelAliases 必须是非空字符串。',
            `${location}.invocation`,
          );
        }
      }
      if (provider?.outputAcquisition !== undefined) {
        const acquisition = provider.outputAcquisition;
        if (
          !isPlainObject(acquisition) ||
          !['local-file', 'public-download-url'].includes(
            acquisition.mode,
          ) ||
          typeof acquisition.evidence !== 'string' ||
          !acquisition.evidence.trim() ||
          !Number.isFinite(Date.parse(acquisition.verifiedAt))
        ) {
          add(
            'error',
            'provider-output-acquisition',
            'outputAcquisition 必须声明已验证的 local-file 或 public-download-url、本地取回证据和验证时间。',
            `${location}.outputAcquisition`,
          );
        }
      }
      if (
        selection?.provider === providerId &&
        provider?.adapter === 'host' &&
        capability !== 'text' &&
        !provider.outputAcquisition
      ) {
        add(
          'error',
          'provider-output-acquisition-required',
          `${capability} host provider 获批前必须验证输出可直接落盘；受登录保护的下载页不算可取回输出。`,
          `${location}.outputAcquisition`,
        );
      }
      if (provider?.adapter === 'command') {
        if (!provider.command?.executable || !Array.isArray(provider.command?.args)) {
          add(
            'error',
            'provider-command',
            'command adapter 必须配置 command.executable 和 command.args。',
            `${location}.command`,
          );
        }
      }
    }
  }
  return issues;
};

export const loadProviderConfig = async (slug = null) => {
  const files = {
    base: path.join(ROOT, 'providers.json'),
    local: path.join(ROOT, 'providers.local.json'),
    project: slug ? path.join(ROOT, 'projects', slug, 'providers.json') : null,
  };
  const base = await readJson(files.base);
  const local = await readOptionalJson(files.local);
  const project = files.project ? await readOptionalJson(files.project) : null;
  const config = [local, project].filter(Boolean).reduce(deepMerge, base);
  const issues = validateProviderConfig(config);
  return {
    config,
    issues,
    sources: [
      {kind: 'base', file: files.base, loaded: true},
      {kind: 'local', file: files.local, loaded: Boolean(local)},
      ...(files.project
        ? [{kind: 'project', file: files.project, loaded: Boolean(project)}]
        : []),
    ],
  };
};

export const resolveProvider = (config, capability, providerId = 'auto') => {
  if (!PROVIDER_CAPABILITIES.includes(capability)) {
    throw new Error(`未知 provider capability：${capability}`);
  }
  const definition = config.capabilities?.[capability];
  const selectedId = !providerId || providerId === 'auto' ? definition?.defaultProvider : providerId;
  const provider = definition?.providers?.[selectedId];
  if (!provider) {
    throw new Error(`${capability} provider 不存在：${selectedId ?? '(empty)'}`);
  }
  return {...provider, id: selectedId, capability};
};

export const summarizeProviderSelections = (config) =>
  Object.fromEntries(
    PROVIDER_CAPABILITIES.map((capability) => {
      const definition = config.capabilities?.[capability];
      const selection = definition?.selection ?? null;
      const confirmed = Boolean(
        selection?.status === 'confirmed' &&
          selection.provider === definition?.defaultProvider &&
          definition?.providers?.[selection.provider],
      );
      return [
        capability,
        {
          confirmed,
          needsConfirmation: !confirmed,
          selection,
        },
      ];
    }),
  );

export const resolveConfirmedProvider = (
  config,
  capability,
  providerId = 'auto',
) => {
  const selection = summarizeProviderSelections(config)[capability];
  if (!selection?.confirmed) {
    throw new Error(`${capability} provider 尚未获得用户确认。`);
  }
  const provider = resolveProvider(config, capability, providerId);
  if (provider.id !== selection.selection.provider) {
    throw new Error(
      `${capability} provider ${provider.id} 未获授权；用户确认的是 ${selection.selection.provider}。`,
    );
  }
  return provider;
};

export const buildProviderInvocation = ({request, provider, attemptId = null, model = null}) => {
  const actualModel =
    model ?? request.model ?? provider.invocation?.modelValue ?? provider.model ?? null;
  const invocation = {
    adapter: provider.adapter,
    tool: provider.tool ?? null,
    provider: provider.invocation?.providerValue ?? provider.id,
    model: actualModel,
    capability: request.capability,
    prompt: request.prompt ?? null,
    text: request.text ?? null,
    voiceId: request.voiceId ?? null,
    settings: request.settings ?? {},
    outputSurface: request.outputSurface ?? null,
    attemptId,
  };
  return {
    ...invocation,
    fingerprint: createHash('sha256')
      .update(JSON.stringify(stableValue(invocation)))
      .digest('hex'),
  };
};

export const normalizeReportedModel = normalizeAttemptModel;

export const assertProviderSelections = (
  loaded,
  {capabilities = CORE_PROVIDER_CAPABILITIES} = {},
) => {
  assertProviderConfig(loaded);
  const selections = summarizeProviderSelections(loaded.config);
  const missing = capabilities.filter(
    (capability) => !selections[capability]?.confirmed,
  );
  if (missing.length) {
    throw new Error(`以下能力尚未获得用户确认：${missing.join(', ')}`);
  }
  return {...loaded, selections};
};

const executableCandidates = (executable) => {
  if (executable.includes('/') || executable.includes('\\')) {
    return [path.isAbsolute(executable) ? executable : path.resolve(ROOT, executable)];
  }
  const suffixes =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
      : [''];
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) => suffixes.map((suffix) => path.join(directory, `${executable}${suffix}`)));
};

export const findExecutable = async (executable) => {
  for (const candidate of executableCandidates(executable)) {
    try {
      await fs.access(candidate, process.platform === 'win32' ? undefined : 1);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  return null;
};

export const inspectProviderReadiness = async (provider) => {
  const missingEnv = (provider.requiredEnv ?? []).filter((name) => !process.env[name]);
  if (provider.adapter === 'host') {
    return {
      status: missingEnv.length ? 'error' : 'agent-check-required',
      message: missingEnv.length
        ? `缺少环境变量：${missingEnv.join(', ')}`
        : provider.toolHint || '需要宿主环境选择并调用对应工具。',
      missingEnv,
    };
  }
  if (provider.adapter === 'manual') {
    return {
      status: missingEnv.length ? 'error' : 'ready',
      message: missingEnv.length
        ? `缺少环境变量：${missingEnv.join(', ')}`
        : provider.toolHint || '可导入本地素材。',
      missingEnv,
    };
  }
  const executable = provider.command?.executable
    ? await findExecutable(provider.command.executable)
    : null;
  const errors = [
    ...(missingEnv.length ? [`缺少环境变量：${missingEnv.join(', ')}`] : []),
    ...(!executable ? [`找不到命令：${provider.command?.executable ?? '(empty)'}`] : []),
  ];
  return {
    status: errors.length ? 'error' : 'ready',
    message: errors.join('；') || `命令适配器可用：${executable}`,
    missingEnv,
    executable,
  };
};

export const assertSelectedProvidersReady = async (
  slug,
  {capabilities = CORE_PROVIDER_CAPABILITIES} = {},
) => {
  const loaded = assertProviderSelections(await loadProviderConfig(slug), {
    capabilities,
  });
  for (const capability of capabilities) {
    const provider = resolveProvider(loaded.config, capability);
    const readiness = await inspectProviderReadiness(provider);
    if (readiness.status === 'error') {
      throw new Error(`${capability} provider ${provider.id} 不可用：${readiness.message}`);
    }
  }
  return loaded;
};

const selectionTarget = (slug, scope) =>
  scope === 'workspace'
    ? path.join(ROOT, 'providers.local.json')
    : path.join(ROOT, 'projects', slug, 'providers.json');

export const writeProviderSelections = async ({
  slug,
  selections,
  scope = 'project',
  note,
  at = new Date().toISOString(),
}) => {
  if (!SLUG_PATTERN.test(slug ?? '')) throw new Error('项目 slug 格式无效。');
  if (!(await fileExists(path.join(ROOT, 'projects', slug, 'production.json')))) {
    throw new Error(`项目不存在：${slug}；请先运行 project:new。`);
  }
  if (!PROVIDER_SCOPES.includes(scope)) {
    throw new Error(`scope 必须是：${PROVIDER_SCOPES.join(', ')}。`);
  }
  if (!(note ?? '').trim()) throw new Error('provider 选择必须记录人的明确决定。');
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error('selections 必须包含至少一个 provider 选择。');
  }
  const capabilities = selections.map(({capability}) => capability);
  if (new Set(capabilities).size !== capabilities.length) {
    throw new Error('同一个 capability 不能在一次确认中重复。');
  }

  const loaded = assertProviderConfig(await loadProviderConfig(slug));
  const target = selectionTarget(slug, scope);
  const overlay = (await fileExists(target))
    ? await readJson(target)
    : {
        $schema:
          scope === 'workspace'
            ? './schemas/providers.schema.json'
            : '../../schemas/providers.schema.json',
        schemaVersion: 1,
      };
  overlay.schemaVersion = 1;
  overlay.capabilities ??= {};
  const projectOverlay =
    scope === 'workspace'
      ? await readOptionalJson(path.join(ROOT, 'projects', slug, 'providers.json'))
      : null;
  let prospectiveConfig = loaded.config;
  const results = [];
  for (const input of selections) {
    const {
      capability,
      providerId,
      label = null,
      adapter = null,
      tool = null,
      model = null,
      outputMode = null,
      outputEvidence = null,
    } = input;
    if (!PROVIDER_CAPABILITIES.includes(capability)) {
      throw new Error(`capability 必须是：${PROVIDER_CAPABILITIES.join(', ')}。`);
    }
    if (!PROVIDER_ID_PATTERN.test(providerId ?? '')) {
      throw new Error('provider id 只能包含小写字母、数字和单个连字符。');
    }
    const existing =
      prospectiveConfig.capabilities?.[capability]?.providers?.[providerId] ??
      null;
    const selectedAdapter = adapter ?? existing?.adapter;
    if (!PROVIDER_ADAPTERS.includes(selectedAdapter)) {
      throw new Error(`新 provider 必须指定 adapter：${PROVIDER_ADAPTERS.join(', ')}。`);
    }
    if (!existing && !label) throw new Error('新 provider 必须指定 label。');
    if (!existing && selectedAdapter === 'command') {
      throw new Error('新的 command provider 请先在 providers.local.json 配置 command，再选择它。');
    }
    const provider = {
      ...(existing ?? {}),
      ...(label ? {label} : {}),
      adapter: selectedAdapter,
      ...(tool ? {tool} : {}),
      ...(model ? {model} : {}),
      ...(outputMode
        ? {
            outputAcquisition: {
              mode: outputMode,
              evidence: String(outputEvidence ?? '').trim(),
              verifiedAt: at,
            },
          }
        : {}),
    };
    if (provider.adapter === 'host' && capability !== 'text' && !provider.tool) {
      throw new Error(
        `host ${capability} provider 必须记录已发现的可调用 tool。`,
      );
    }
    if (
      provider.adapter === 'host' &&
      capability !== 'text' &&
      (
        !['local-file', 'public-download-url'].includes(
          provider.outputAcquisition?.mode,
        ) ||
        !provider.outputAcquisition?.evidence
      )
    ) {
      throw new Error(
        `host ${capability} provider 必须先验证输出可直接落盘，并记录 --output-mode=local-file|public-download-url 与 --output-evidence。`,
      );
    }
    if (scope === 'workspace') {
      const projectCapability = projectOverlay?.capabilities?.[capability];
      if (projectCapability?.defaultProvider || projectCapability?.selection) {
        throw new Error(
          `${capability} 已有项目级选择；项目配置优先于 workspace。请保留 project scope，或先显式移除该项目覆盖。`,
        );
      }
    }
    const selection = {
      status: 'confirmed',
      provider: providerId,
      confirmedAt: at,
      scope,
      note: (input.note ?? note).trim(),
    };
    overlay.capabilities[capability] ??= {};
    const targetCapability = overlay.capabilities[capability];
    targetCapability.defaultProvider = providerId;
    if (
      !existing ||
      label ||
      adapter ||
      tool ||
      model ||
      outputMode
    ) {
      targetCapability.providers ??= {};
      targetCapability.providers[providerId] = provider;
    }
    targetCapability.selection = selection;
    prospectiveConfig = deepMerge(prospectiveConfig, {
      capabilities: {
        [capability]: {
          defaultProvider: providerId,
          providers: {[providerId]: provider},
          selection,
        },
      },
    });
    assertProviderConfig({
      config: prospectiveConfig,
      issues: validateProviderConfig(prospectiveConfig),
    });
    results.push({
      provider: {...provider, id: providerId, capability},
      selection,
    });
  }
  await writeJson(target, overlay);
  return {
    target,
    selections: results,
    loaded: assertProviderConfig(await loadProviderConfig(slug)),
  };
};

export const writeProviderSelection = async (input) => {
  const result = await writeProviderSelections({
    slug: input.slug,
    selections: [input],
    scope: input.scope,
    note: input.note,
    at: input.at,
  });
  return {
    target: result.target,
    provider: result.selections[0].provider,
    selection: result.selections[0].selection,
    loaded: result.loaded,
  };
};

export const assertProviderConfig = (loaded) => {
  const errors = loaded.issues.filter(({level}) => level === 'error');
  if (errors.length) {
    throw new Error(errors.map(({location, message}) => `${location}: ${message}`).join('\n'));
  }
  return loaded;
};

export const resolveWorkspacePath = (input, label = '路径') => {
  if (!input || typeof input !== 'string') throw new Error(`${label}不能为空。`);
  const resolved = path.resolve(ROOT, input);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error(`${label}越过工作区：${input}`);
  }
  return resolved;
};

const CONTEXT_PRESERVING_RECOVERY_POLICY = {
  strategy: 'preserve-sheet-context',
  localDeterministicFixFirst: true,
  isolatedCellGeneration: 'forbidden',
  fallback: 'full-sheet-regeneration',
};

const sameMembers = (left, right) =>
  Array.isArray(left) &&
  Array.isArray(right) &&
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

const validRecoveryPolicy = (policy) =>
  isPlainObject(policy) &&
  Object.entries(CONTEXT_PRESERVING_RECOVERY_POLICY)
    .every(([key, value]) => policy[key] === value) &&
  Object.keys(policy).length === Object.keys(CONTEXT_PRESERVING_RECOVERY_POLICY).length;

export const inspectStateSheetRecoveryMask = async ({maskFile, stateSheetBinding, recoveryBinding}) => {
  try {
    const mask = await sharp(maskFile).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    const {width, height, channels} = mask.info;
    const targeted = new Set(recoveryBinding.targetStateIds);
    const targetCells = new Set(
      stateSheetBinding.states
        .filter(({stateId}) => targeted.has(stateId))
        .map(({row, column}) => `${row}:${column}`),
    );
    let activePixels = 0;
    let activeOutsideTarget = 0;
    for (let y = 0; y < height; y += 1) {
      const row = Math.min(stateSheetBinding.layout.rows - 1, Math.floor(y * stateSheetBinding.layout.rows / height));
      for (let x = 0; x < width; x += 1) {
        const column = Math.min(stateSheetBinding.layout.columns - 1, Math.floor(x * stateSheetBinding.layout.columns / width));
        const offset = (y * width + x) * channels;
        const luminance = (mask.data[offset] + mask.data[offset + 1] + mask.data[offset + 2]) / 3;
        const alpha = mask.data[offset + channels - 1];
        if (alpha <= 16 || luminance <= 127) continue;
        activePixels += 1;
        if (!targetCells.has(`${row}:${column}`)) activeOutsideTarget += 1;
      }
    }
    return {
      passed: activePixels > 0 && activeOutsideTarget === 0,
      activePixels,
      activeOutsideTarget,
      width,
      height,
    };
  } catch (error) {
    return {passed: false, reason: error.message};
  }
};

export const validateAssetRequest = (request) => {
  const errors = [];
  if (request?.schemaVersion !== 8) errors.push('schemaVersion 必须为 8');
  if (!SLUG_PATTERN.test(request?.projectSlug ?? '')) errors.push('projectSlug 格式无效');
  if (!SLUG_PATTERN.test(request?.assetId ?? '')) errors.push('assetId 格式无效');
  if (!PROVIDER_CAPABILITIES.includes(request?.capability)) errors.push('capability 必须是 text、image、voice 或 sound');
  if (!request?.output || typeof request.output !== 'string') errors.push('output 不能为空');
  if (request?.capability === 'text' && !request.prompt) errors.push('text request 缺少 prompt');
  if (request?.capability === 'image' && !request.prompt) errors.push('image request 缺少 prompt');
  if (request?.capability === 'sound' && !request.prompt) errors.push('sound request 缺少 prompt');
  if (request?.capability === 'image' && !isPlainObject(request.compositionBinding)) {
    errors.push('image request 缺少 compositionBinding');
  }
  if (request?.capability === 'image' && !isPlainObject(request.semanticBinding)) {
    errors.push('schema-v8 image request 缺少 semanticBinding');
  }
  if (request?.scenarioRootBinding !== undefined) {
    const binding = request.scenarioRootBinding;
    if (
      request.capability !== 'image' ||
      !isPlainObject(binding) ||
      binding.schemaVersion !== 1 ||
      !/^[a-f0-9]{64}$/.test(binding.planFingerprint ?? '') ||
      typeof binding.rootId !== 'string' ||
      !binding.rootId
    ) {
      errors.push(
        'scenarioRootBinding 只能用于 image request，且必须声明 schemaVersion、planFingerprint 和 rootId',
      );
    }
  }
  if (request?.providerSource !== undefined) {
    const source = request.providerSource;
    const target = source?.normalization?.targetCanvas;
    const expected = request.compositionBinding?.canvas;
    if (request.capability !== 'image') {
      errors.push('providerSource 只能用于 image request');
    } else if (
      !isPlainObject(source) ||
      source.mode !== 'provider-native' ||
      !Number.isInteger(source.minimumWidth) ||
      source.minimumWidth < 2 ||
      !Number.isInteger(source.minimumHeight) ||
      source.minimumHeight < 2 ||
      !Number.isFinite(source.aspectRatioTolerance) ||
      source.aspectRatioTolerance < 0 ||
      source.aspectRatioTolerance > 0.1 ||
      source.normalization?.method !== 'deterministic-resize' ||
      !Number.isInteger(target?.width) ||
      target.width < 1 ||
      !Number.isInteger(target?.height) ||
      target.height < 1
    ) {
      errors.push(
        'providerSource 必须声明 provider-native 最小画布、宽高比容差和 deterministic-resize 目标。',
      );
    } else if (
      target.width !== expected?.width ||
      target.height !== expected?.height
    ) {
      errors.push(
        'providerSource.normalization.targetCanvas 必须与 compositionBinding.canvas 一致。',
      );
    }
  }
  if (
    request?.capability === 'image' &&
    request.compositionBinding?.pattern === 'looping-environment'
  ) {
    const binding = request.worldTopologyBinding;
    if (
      !isPlainObject(binding) ||
      binding.schemaVersion !== 1 ||
      !binding.proofId ||
      !/^[a-f0-9]{64}$/.test(binding.fingerprint ?? '') ||
      !binding.stripId
    ) {
      errors.push(
        'looping-environment image request 必须绑定通过的 worldTopologyBinding。',
      );
    }
  } else if (request?.worldTopologyBinding !== undefined) {
    errors.push('worldTopologyBinding 只能用于 looping-environment image request');
  }
  if (request?.capability === 'image') {
    const styleIssues = validateStyleProfileBinding(
      request.styleProfileBinding,
    );
    errors.push(...styleIssues.map(({message}) => message));
    if (
      !isPlainObject(request.quality) ||
      !Array.isArray(request.quality.requiredChecks) ||
      !request.quality.requiredChecks.includes('style-profile-conformant')
    ) {
      errors.push(
        'schema-v8 image request 的 quality.requiredChecks 必须包含 style-profile-conformant',
      );
    }
    const surface = request.outputSurface;
    if (
      !isPlainObject(surface) ||
      !['alpha', 'chroma-key', 'opaque', 'layer-sheet', 'seamless-strip-x'].includes(surface.mode)
    ) {
      errors.push('schema-v8 image request 缺少有效 outputSurface');
    } else {
      if (
        surface.mode === 'chroma-key' &&
        (typeof surface.keyColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(surface.keyColor))
      ) {
        errors.push('chroma-key outputSurface 必须声明 #RRGGBB keyColor');
      }
      if (
        surface.tolerance !== undefined &&
        (!Number.isInteger(surface.tolerance) || surface.tolerance < 0 || surface.tolerance > 255)
      ) {
        errors.push('outputSurface.tolerance 必须是 0–255 的整数');
      }
      if (surface.keyPlane !== undefined) {
        if (surface.mode !== 'chroma-key') {
          errors.push('只有 chroma-key outputSurface 可以声明 keyPlane');
        } else {
          try {
            validateObservedKeyPlaneDeclaration(surface.keyPlane);
          } catch (error) {
            errors.push(error.message);
          }
        }
      }
      if (
        surface.mode === 'layer-sheet' &&
        (
          surface.keyColor !== undefined ||
          surface.tolerance !== undefined ||
          surface.keyPlane !== undefined
        )
      ) {
        errors.push('layer-sheet outputSurface 的色键必须逐格声明');
      }
      if (
        surface.mode === 'seamless-strip-x' &&
        !(Number.isFinite(surface.minimumViewportSpan) && surface.minimumViewportSpan >= 1)
      ) {
        errors.push('seamless-strip-x outputSurface 必须声明 minimumViewportSpan>=1');
      }
    }
  }
  if (request?.capability === 'voice' && !request.text) errors.push('voice request 缺少 text');
  if (request?.capability === 'sound') {
    const binding = request.soundBinding;
    if (
      !isPlainObject(binding) ||
      typeof binding.cue !== 'string' ||
      !binding.cue.trim() ||
      !Array.isArray(binding.bindings) ||
      binding.bindings.length === 0
    ) {
      errors.push('sound request 缺少有效 soundBinding.cue 与 bindings');
    } else {
      for (const [index, item] of binding.bindings.entries()) {
        if (
          !isPlainObject(item) ||
          typeof item.sceneId !== 'string' ||
          !item.sceneId ||
          typeof item.beatId !== 'string' ||
          !item.beatId ||
          typeof item.targetId !== 'string' ||
          !item.targetId ||
          !Number.isFinite(item.at) ||
          item.at < 0 ||
          item.at > 1 ||
          typeof item.proofTimeId !== 'string' ||
          !item.proofTimeId
        ) {
          errors.push(`soundBinding.bindings[${index}] 无效`);
        }
      }
    }
  } else if (request?.soundBinding !== undefined) {
    errors.push('soundBinding 只能用于 sound request');
  }
  if (request?.timingBinding !== undefined) {
    if (request.capability !== 'voice') errors.push('只有 voice request 可以声明 timingBinding');
    const binding = request.timingBinding;
    if (!isPlainObject(binding) || !binding.sceneId || typeof binding.sceneId !== 'string') {
      errors.push('timingBinding 必须声明 sceneId');
    } else {
      const minimum = binding.minDurationSeconds;
      const maximum = binding.maxDurationSeconds;
      const validBound = (value) => value === undefined || (Number.isFinite(value) && value > 0);
      if (!validBound(minimum) || !validBound(maximum)) {
        errors.push('timingBinding 的时长边界必须是正数');
      }
      if (minimum === undefined && maximum === undefined) {
        errors.push('timingBinding 至少需要 minDurationSeconds 或 maxDurationSeconds');
      }
      if (Number.isFinite(minimum) && Number.isFinite(maximum) && minimum > maximum) {
        errors.push('timingBinding.minDurationSeconds 不能大于 maxDurationSeconds');
      }
    }
  }
  if (request?.quality !== undefined) {
    if (request.capability !== 'image') {
      errors.push('只有 image request 可以声明 quality');
    }
    if (
      request.quality.kind !== undefined &&
      !IMAGE_QUALITY_KINDS.includes(request.quality.kind)
    ) {
      errors.push('quality.kind 无效');
    }
    if (
      request.quality.requiredChecks !== undefined &&
      (!Array.isArray(request.quality.requiredChecks) ||
        request.quality.requiredChecks.length === 0 ||
        request.quality.requiredChecks.some(
          (check) => !IMAGE_QUALITY_CHECKS.includes(check),
        ))
    ) {
      errors.push('quality.requiredChecks 含未知检查或为空');
    }
  }
  if (request?.compositionBinding !== undefined) {
    if (request.capability !== 'image') errors.push('只有 image request 可以声明 compositionBinding');
    const binding = request.compositionBinding;
    if (!binding.sceneId || !binding.nodeId || !binding.outputRole) errors.push('compositionBinding 缺少 sceneId、nodeId 或 outputRole');
    if (!['free', 'supported-subject', 'registered-environment', 'registered-depth-stack', 'looping-environment', 'state-sequence', 'canonical-container'].includes(binding.pattern)) errors.push('compositionBinding.pattern 无效');
    if (!Number.isInteger(binding.canvas?.width) || binding.canvas.width < 1 || !Number.isInteger(binding.canvas?.height) || binding.canvas.height < 1) errors.push('compositionBinding.canvas 无效');
    if (!['provider-generation', 'provider-edit', 'alpha-extraction', 'crop', 'seamless-period-crop', 'mask-application', 'manual-import'].includes(binding.derivation?.method)) errors.push('compositionBinding.derivation.method 无效');
    if (binding.pattern !== 'state-sequence' && (request.stateBinding || request.stateSheetBinding || request.stateSheetRecoveryBinding)) errors.push('stateBinding/stateSheetBinding/stateSheetRecoveryBinding 只能用于 state-sequence');
    if (['supported-subject', 'registered-environment', 'registered-depth-stack', 'state-sequence', 'canonical-container'].includes(binding.pattern) && (!binding.registrationId || !binding.sourceMasterAssetId)) errors.push('耦合素材必须声明 registrationId 和 sourceMasterAssetId');
    if (
      binding.pattern === 'registered-depth-stack' &&
      !isPlainObject(request.layerPackageBinding)
    ) {
      errors.push('registered-depth-stack 图像必须声明 layerPackageBinding');
    }
    if (
      binding.pattern === 'canonical-container' &&
      !isPlainObject(request.containerPackageBinding)
    ) {
      errors.push(
        'canonical-container 图像必须声明 containerPackageBinding',
      );
    }
    if (binding.pattern === 'state-sequence') {
      const state = request.stateBinding;
      const sheet = request.stateSheetBinding;
      const recovery = request.stateSheetRecoveryBinding;
      if (Boolean(state) === Boolean(sheet)) errors.push('state-sequence 图像必须且只能声明 stateBinding 或 stateSheetBinding 之一');
      if (
        state &&
        (
          !isPlainObject(state) ||
          !state.poseFamilyId ||
          !state.stateId ||
          !state.registrationId ||
          !state.sourceMasterAssetId ||
          !['left', 'right', 'front', 'back', 'neutral'].includes(state.facing) ||
          !validStateAnchors(state.anchors) ||
          !state.identityReferenceAssetId
        )
      ) errors.push('stateBinding 不完整');
      const generationFamily = request.semanticBinding?.generationFamily;
      if (!isPlainObject(generationFamily)) errors.push('state-sequence 图像必须声明 semanticBinding.generationFamily');
      if (state && generationFamily && (
        generationFamily.familyId !== state.poseFamilyId ||
        !generationFamily.stateMemberIds?.includes(state.stateId)
      )) errors.push('stateBinding 必须属于 semanticBinding.generationFamily');
      if (state && generationFamily?.stateMemberIds?.length > 1 && ['provider-generation', 'provider-edit'].includes(binding.derivation?.method)) {
        errors.push('多状态姿态族禁止独立单格 provider 生成；请使用完整 stateSheetBinding 或带整表上下文的 stateSheetRecoveryBinding');
      }
      if (state && recovery) errors.push('独立 stateBinding 不得声明 stateSheetRecoveryBinding');
      if (sheet) {
        if (
          !isPlainObject(sheet) ||
          !sheet.poseFamilyId ||
          !sheet.registrationId ||
          !sheet.sourceMasterAssetId ||
          !sheet.identityReferenceAssetId ||
          !Array.isArray(sheet.anchorPolicy?.requiredAnchorIds) ||
          sheet.anchorPolicy.requiredAnchorIds.length < 1 ||
          !Number.isFinite(sheet.anchorPolicy?.maximumDrift) ||
          sheet.anchorPolicy.maximumDrift < 0 ||
          sheet.anchorPolicy.maximumDrift > 0.1 ||
          !Number.isInteger(sheet.layout?.columns) ||
          !Number.isInteger(sheet.layout?.rows) ||
          !Array.isArray(sheet.states) ||
          sheet.states.length < 2 ||
          !validRecoveryPolicy(sheet.recoveryPolicy)
        ) errors.push('stateSheetBinding 必须声明完整的身份参考、逐状态锚点与 preserve-sheet-context 恢复策略');
        if (sheet.registrationId !== binding.registrationId || sheet.sourceMasterAssetId !== binding.sourceMasterAssetId) errors.push('stateSheetBinding 必须与 compositionBinding 使用同一注册族');
        const cells = new Set();
        const stateIds = new Set();
        for (const member of sheet.states ?? []) {
          const cell = `${member.row}:${member.column}`;
          if (!member.stateId || stateIds.has(member.stateId) || cells.has(cell) || member.row < 0 || member.row >= sheet.layout.rows || member.column < 0 || member.column >= sheet.layout.columns) errors.push('stateSheetBinding 状态 id/格位重复或越界');
          if (
            !['left', 'right', 'front', 'back', 'neutral'].includes(member.facing) ||
            !validStateAnchors(member.anchors)
          ) {
            errors.push('stateSheetBinding 每个状态必须声明有效 facing 与归一化 anchors');
          }
          stateIds.add(member.stateId);
          cells.add(cell);
        }
        const anchorProof = inspectStateAnchorRegistration({
          states: sheet.states ?? [],
          anchorPolicy: sheet.anchorPolicy,
        });
        if (!anchorProof.passed) {
          errors.push('stateSheetBinding 逐状态 anchor 漂移超过 anchorPolicy.maximumDrift');
        }
        if (
          generationFamily &&
          !generationFamily.referenceAssetIds?.includes(
            sheet.identityReferenceAssetId,
          )
        ) {
          errors.push('stateSheetBinding.identityReferenceAssetId 必须属于 generationFamily.referenceAssetIds');
        }
        if (generationFamily && (
          generationFamily.familyId !== sheet.poseFamilyId ||
          !sameMembers(generationFamily.stateMemberIds, sheet.states.map(({stateId}) => stateId))
        )) errors.push('stateSheetBinding 必须与 semanticBinding.generationFamily 使用同一 family 和成员集合');
        if (recovery) {
          const allStateIds = sheet.states.map(({stateId}) => stateId);
          const targetStateIds = recovery.targetStateIds ?? [];
          if (!isPlainObject(recovery) || !['masked-sheet-edit', 'full-sheet-regeneration'].includes(recovery.mode) || !recovery.sourceSheetAssetId || !Array.isArray(recovery.targetStateIds) || recovery.targetStateIds.length === 0 || new Set(recovery.targetStateIds).size !== recovery.targetStateIds.length || recovery.targetStateIds.some((stateId) => !stateIds.has(stateId))) {
            errors.push('stateSheetRecoveryBinding 模式、来源或目标状态无效');
          }
          if (binding.derivation?.parentAssetId !== recovery.sourceSheetAssetId) errors.push('恢复请求必须把完整原状态表声明为 derivation.parentAssetId');
          if (!generationFamily?.referenceAssetIds?.includes(recovery.sourceSheetAssetId)) errors.push('恢复请求必须把完整原状态表加入 generationFamily.referenceAssetIds');
          const recoveryChecks = request.quality?.requiredChecks ?? [];
          for (const check of ['identity-family-consistent', 'cell-separation', 'reference-conformant']) {
            if (!recoveryChecks.includes(check)) errors.push(`状态表恢复请求必须包含质量检查 ${check}`);
          }
          if (recovery.mode === 'masked-sheet-edit') {
            if (!recovery.maskAssetId || recovery.maskPolarity !== 'white-is-editable' || binding.derivation?.method !== 'provider-edit') errors.push('masked-sheet-edit 必须声明 white-is-editable maskAssetId 并使用 provider-edit');
            if (sameMembers(targetStateIds, allStateIds)) errors.push('所有格都需要重做时必须使用 full-sheet-regeneration');
            if (!recoveryChecks.includes('untargeted-cells-unchanged')) errors.push('masked-sheet-edit 必须检查 untargeted-cells-unchanged');
          }
          if (recovery.mode === 'full-sheet-regeneration') {
            if (binding.derivation?.method !== 'provider-generation') errors.push('full-sheet-regeneration 必须使用 provider-generation');
            if (!sameMembers(targetStateIds, allStateIds)) errors.push('full-sheet-regeneration 必须覆盖姿态族的全部状态');
            if (recovery.maskAssetId || recovery.maskPolarity) errors.push('full-sheet-regeneration 不得声明局部 mask');
          }
        }
      }
    }
  }
  if (request?.layerPackageBinding !== undefined) {
    const binding = request.layerPackageBinding;
    const roleCompleteness = {
      'support-rear': 'clean-plate',
      subject: 'full-silhouette',
      'support-front': 'full-overlay',
    };
    if (request.capability !== 'image' || !isPlainObject(binding)) {
      errors.push('layerPackageBinding 只能用于 image request');
    } else {
      if (
        !SLUG_PATTERN.test(binding.sourcePackageId ?? '') ||
        !['supported-subject', 'registered-depth-stack'].includes(
          binding.pattern,
        ) ||
        binding.motionCapability !== 'bounded-relative' ||
        ![
          'registered-layer-sheet',
          'context-preserving-layer-edits',
        ].includes(binding.sourceStrategy)
      ) {
        errors.push('layerPackageBinding 的 id、pattern、motionCapability 或 sourceStrategy 无效');
      }
      if (
        binding.registrationId !==
          request.compositionBinding?.registrationId ||
        binding.sourceMasterAssetId !==
          request.compositionBinding?.sourceMasterAssetId ||
        binding.pattern !== request.compositionBinding?.pattern
      ) {
        errors.push('layerPackageBinding 必须与 compositionBinding 使用同一 pattern、registration 和 source master');
      }
      const sheetOutput =
        binding.sourceStrategy === 'registered-layer-sheet';
      const expectedCompositionCanvas = sheetOutput
        ? {
            width: binding.canvas?.width * 2,
            height: binding.canvas?.height * 2,
          }
        : binding.canvas;
      if (
        expectedCompositionCanvas?.width !==
          request.compositionBinding?.canvas?.width ||
        expectedCompositionCanvas?.height !==
          request.compositionBinding?.canvas?.height
      ) {
        errors.push(
          sheetOutput
            ? 'registered-layer-sheet 输出画布必须是成员注册画布的 2x2'
            : 'layerPackageBinding.canvas 必须与 compositionBinding.canvas 一致',
        );
      }
      if (
        !Array.isArray(binding.memberAssetIds) ||
        binding.memberAssetIds.length !== 3 ||
        new Set(binding.memberAssetIds).size !== 3 ||
        binding.memberAssetIds.some(
          (assetId) => !SLUG_PATTERN.test(assetId),
        )
      ) {
        errors.push('layerPackageBinding.memberAssetIds 必须恰好列出三个唯一层成员');
      }
      if (
        !Array.isArray(binding.referenceAssetIds) ||
        binding.referenceAssetIds.length === 0 ||
        !binding.referenceAssetIds.includes(
          binding.sourceMasterAssetId,
        )
      ) {
        errors.push('layerPackageBinding.referenceAssetIds 必须包含完整 source master');
      }
      const expectedRecovery = {
        completeSourceContext: true,
        localDeterministicFixFirst: true,
        isolatedMemberGeneration: 'forbidden',
        providerRepair: 'masked-complete-source-edit',
        fallback: 'full-source-regeneration',
      };
      if (
        JSON.stringify(stableValue(binding.recoveryPolicy)) !==
        JSON.stringify(stableValue(expectedRecovery))
      ) {
        errors.push('layerPackageBinding.recoveryPolicy 必须禁止 isolated member generation 并保留完整 source context');
      }
      const layerRole = roleCompleteness[binding.packageRole];
      if (layerRole) {
        if (
          binding.completeness !== layerRole ||
          request.compositionBinding?.outputRole !==
            binding.packageRole ||
          !binding.memberAssetIds.includes(request.assetId)
        ) {
          errors.push('层成员 request 的 role、completeness、outputRole 与 memberAssetIds 必须一致');
        }
      } else if (
        !['reference', 'registered-sheet'].includes(
          binding.packageRole,
        ) ||
        binding.completeness !== null
      ) {
        errors.push('非层成员 packageRole 必须是 reference 或 registered-sheet，且 completeness 为 null');
      }
      if (
        binding.sourceStrategy === 'registered-layer-sheet' &&
        binding.packageRole !== 'registered-sheet'
      ) {
        errors.push('registered-layer-sheet 的唯一 provider request 必须生成完整 registered sheet');
      }
      if (binding.sourceStrategy === 'registered-layer-sheet') {
        const layout = binding.sheetLayout;
        const cells = layout?.cells ?? [];
        const expectedRoles = [
          'reference',
          'support-rear',
          'subject',
          'support-front',
        ];
        if (
          layout?.columns !== 2 ||
          layout?.rows !== 2 ||
          cells.length !== 4 ||
          new Set(cells.map(({packageRole}) => packageRole)).size !== 4 ||
          expectedRoles.some(
            (role) =>
              !cells.some(({packageRole}) => packageRole === role),
          ) ||
          new Set(
            cells.map(({row, column}) => `${row}:${column}`),
          ).size !== 4 ||
          cells.some(
            ({row, column}) =>
              ![0, 1].includes(row) || ![0, 1].includes(column),
          )
        ) {
          errors.push('registered-layer-sheet 必须声明 reference + 三层的完整 2x2 sheetLayout');
        }
        if (request.outputSurface?.mode !== 'layer-sheet') {
          errors.push('registered-layer-sheet provider root 必须使用逐格 layer-sheet outputSurface');
        }
        for (const cell of cells) {
          const surface = cell.outputSurface;
          if (
            !isPlainObject(surface) ||
            !['alpha', 'chroma-key', 'opaque'].includes(surface.mode)
          ) {
            errors.push(`registered-layer-sheet ${cell.packageRole ?? 'unknown'} 格缺少有效 outputSurface`);
            continue;
          }
          if (
            surface.mode === 'chroma-key' &&
            (typeof surface.keyColor !== 'string' ||
              !/^#[0-9a-fA-F]{6}$/.test(surface.keyColor))
          ) {
            errors.push(`registered-layer-sheet ${cell.packageRole} 色键格必须声明 #RRGGBB keyColor`);
          }
          if (
            surface.tolerance !== undefined &&
            (!Number.isInteger(surface.tolerance) ||
              surface.tolerance < 0 ||
              surface.tolerance > 255)
          ) {
            errors.push(`registered-layer-sheet ${cell.packageRole} tolerance 必须是 0–255 的整数`);
          }
          if (surface.keyPlane !== undefined) {
            if (surface.mode !== 'chroma-key') {
              errors.push(`registered-layer-sheet ${cell.packageRole} 非色键格不得声明 keyPlane`);
            } else {
              try {
                validateObservedKeyPlaneDeclaration(surface.keyPlane);
              } catch (error) {
                errors.push(`registered-layer-sheet ${cell.packageRole} ${error.message}`);
              }
            }
          }
          if (
            ['reference', 'support-rear'].includes(cell.packageRole) &&
            surface.mode !== 'opaque'
          ) {
            errors.push(`registered-layer-sheet ${cell.packageRole} 必须是 opaque`);
          }
          if (
            ['subject', 'support-front'].includes(cell.packageRole) &&
            !['alpha', 'chroma-key'].includes(surface.mode)
          ) {
            errors.push(`registered-layer-sheet ${cell.packageRole} 必须是 alpha 或 chroma-key`);
          }
        }
        const providerSource = layout?.providerSource;
        if (
          providerSource !== undefined &&
          providerSource !== null &&
          (
            providerSource.canvasMode !== 'provider-native' ||
            !Number.isInteger(providerSource.minimumWidth) ||
            providerSource.minimumWidth < 2 ||
            !Number.isInteger(providerSource.minimumHeight) ||
            providerSource.minimumHeight < 2 ||
            providerSource.cellExtraction !== 'explicit-rects'
          )
        ) {
          errors.push('registered-layer-sheet providerSource 必须声明 provider-native、最小画布与 explicit-rects');
        }
        if (
          providerSource?.canvasMode === 'provider-native' &&
          request.compositionBinding?.derivation?.method !== 'manual-import' &&
          cells.some(
            ({outputSurface}) =>
              outputSurface?.mode === 'chroma-key' &&
              outputSurface?.keyPlane?.mode !== OBSERVED_KEY_PLANE_MODE,
          )
        ) {
          errors.push(
            'provider 生成的 provider-native registered-layer-sheet 色键格必须声明 provider-native-observed keyPlane',
          );
        }
      } else if (binding.sheetLayout !== null) {
        errors.push('context-preserving-layer-edits 的 sheetLayout 必须为 null');
      }
      if (
        binding.sourceStrategy ===
        'context-preserving-layer-edits'
      ) {
        if (
          binding.packageRole === 'registered-sheet' ||
          (binding.packageRole === 'reference' &&
            request.compositionBinding?.derivation?.method !==
              'provider-generation') ||
          (layerRole &&
            request.compositionBinding?.derivation?.method !==
              'provider-edit')
        ) {
          errors.push('context-preserving-layer-edits 必须由一张 reference generation 和三个完整上下文 provider edits 组成');
        }
        if (
          layerRole &&
          !binding.referenceAssetIds.includes(
            request.compositionBinding?.derivation?.parentAssetId,
          )
        ) {
          errors.push('分层 provider edit 必须把完整 reference 声明为 derivation.parentAssetId');
        }
      }
    }
  }
  if (request?.containerPackageBinding !== undefined) {
    const binding = request.containerPackageBinding;
    if (
      request.capability !== 'image' ||
      !isPlainObject(binding)
    ) {
      errors.push('containerPackageBinding 只能用于 image request');
    } else {
      const composition = request.compositionBinding;
      if (
        composition?.pattern !== 'canonical-container' ||
        binding.sourceStrategy !==
          'canonical-frame-with-content-sheet' ||
        binding.registrationId !== composition.registrationId ||
        binding.sourceMasterAssetId !==
          composition.sourceMasterAssetId
      ) {
        errors.push(
          'containerPackageBinding 必须与 canonical-container compositionBinding 使用同一注册族',
        );
      }
      errors.push(
        ...validateCanonicalContainerIntent(
          {
            pattern: 'canonical-container',
            container: {
              ...binding,
              groupId: composition?.nodeId,
              states: (binding.states ?? []).map(
                ({stateId, ...state}) => ({
                  id: stateId,
                  ...state,
                }),
              ),
            },
          },
          {location: 'request.compositionBinding'},
        ).map(({message}) => message),
      );
      const ids = [
        binding.cleanPlateAssetId,
        binding.canonicalFrameAssetId,
        binding.contentSheetAssetId,
        binding.interiorMaskAssetId,
      ];
      if (
        !PROVIDER_ID_PATTERN.test(binding.familyId ?? '') ||
        !PROVIDER_ID_PATTERN.test(binding.sourcePackageId ?? '') ||
        ids.some((id) => !PROVIDER_ID_PATTERN.test(id ?? '')) ||
        new Set(ids).size !== ids.length
      ) {
        errors.push(
          'container package 必须声明唯一且格式有效的 plate/frame/sheet/mask 资产 id',
        );
      }
      if (
        binding.frameRedrawPolicy !==
          'forbidden-in-content-states' ||
        binding.duplicateSurfacePolicy !==
          'single-authoritative-state-sequence'
      ) {
        errors.push(
          'container package 必须禁止状态格重画容器，并只保留一个权威内部表面消费者',
        );
      }
      const expectedRecovery = {
        strategy: 'preserve-content-sheet-context',
        localDeterministicFixFirst: true,
        isolatedStateGeneration: 'forbidden',
        providerRepair: 'masked-complete-sheet-edit',
        fallback: 'full-content-sheet-regeneration',
      };
      if (
        JSON.stringify(stableValue(binding.recoveryPolicy)) !==
        JSON.stringify(stableValue(expectedRecovery))
      ) {
        errors.push(
          'container recoveryPolicy 必须保留完整内容状态表上下文并禁止 isolated state generation',
        );
      }
      const states = binding.states ?? [];
      const cells = new Set();
      const stateIds = new Set();
      let previousAt = -Infinity;
      let previousFill = -Infinity;
      const layout = binding.sheetLayout;
      if (
        !Number.isInteger(layout?.columns) ||
        layout.columns < 1 ||
        layout.columns > 4 ||
        !Number.isInteger(layout?.rows) ||
        layout.rows < 1 ||
        layout.rows > 4 ||
        !Array.isArray(states) ||
        states.length < 2 ||
        states.length > layout.columns * layout.rows
      ) {
        errors.push(
          'container content state sheet 必须声明可容纳至少两个状态的 1..4 网格',
        );
      }
      for (const state of states) {
        const cell = `${state.row}:${state.column}`;
        if (
          !PROVIDER_ID_PATTERN.test(state.stateId ?? '') ||
          stateIds.has(state.stateId) ||
          cells.has(cell) ||
          !Number.isInteger(state.row) ||
          state.row < 0 ||
          state.row >= (layout?.rows ?? 0) ||
          !Number.isInteger(state.column) ||
          state.column < 0 ||
          state.column >= (layout?.columns ?? 0) ||
          !Number.isFinite(state.at) ||
          state.at < 0 ||
          state.at > 1 ||
          state.at <= previousAt ||
          !Number.isFinite(state.fillLevel) ||
          state.fillLevel < 0 ||
          state.fillLevel > 1 ||
          state.fillLevel <= previousFill
        ) {
          errors.push(
            'container states 必须具有唯一格位、唯一 id，并按 at/fillLevel 严格递增',
          );
        }
        stateIds.add(state.stateId);
        cells.add(cell);
        previousAt = state.at ?? previousAt;
        previousFill = state.fillLevel ?? previousFill;
      }
      if (
        !states.some(
          ({stateId}) => stateId === binding.terminalStateId,
        ) ||
        states.at(-1)?.stateId !== binding.terminalStateId
      ) {
        errors.push(
          'container terminalStateId 必须引用最后一个最高水位状态',
        );
      }
      const roleToAssetId = {
        'clean-plate': binding.cleanPlateAssetId,
        'canonical-frame': binding.canonicalFrameAssetId,
        'content-state-sheet': binding.contentSheetAssetId,
      };
      const expectedOutputRole = {
        'clean-plate': 'container-clean-plate',
        'canonical-frame': 'container-frame',
        'content-state-sheet': 'container-content-state-sheet',
      };
      if (
        !Object.hasOwn(roleToAssetId, binding.packageRole) ||
        roleToAssetId[binding.packageRole] !== request.assetId ||
        composition?.outputRole !==
          expectedOutputRole[binding.packageRole]
      ) {
        errors.push(
          'container request 的 packageRole、assetId 与 outputRole 必须一致',
        );
      }
      const expectedCanvas =
        binding.packageRole === 'content-state-sheet'
          ? {
              width: binding.canvas?.width * layout?.columns,
              height: binding.canvas?.height * layout?.rows,
            }
          : binding.canvas;
      if (
        expectedCanvas?.width !== composition?.canvas?.width ||
        expectedCanvas?.height !== composition?.canvas?.height
      ) {
        errors.push(
          'container request composition canvas 与注册画布或内容状态表网格不一致',
        );
      }
      const surfaceMode = request.outputSurface?.mode;
      if (
        (
          binding.packageRole === 'clean-plate' &&
          surfaceMode !== 'opaque'
        ) ||
        (
          binding.packageRole === 'canonical-frame' &&
          !['alpha', 'chroma-key'].includes(surfaceMode)
        ) ||
        (
          binding.packageRole === 'content-state-sheet' &&
          surfaceMode !== 'alpha'
        )
      ) {
        errors.push(
          'clean plate 必须 opaque，canonical frame 必须透明/色键，content state sheet 必须 alpha',
        );
      }
      const directive =
        CANONICAL_CONTAINER_PROMPT_DIRECTIVES[binding.packageRole];
      if (!directive || !request.prompt?.includes(directive)) {
        errors.push(
          `container prompt 必须包含角色约束 ${directive ?? 'unknown-role'}`,
        );
      }
      const roleChecks = {
        'clean-plate': ['clean-plate-clear'],
        'canonical-frame': ['canonical-frame-only'],
        'content-state-sheet': [
          'container-content-only',
          'container-state-separation',
          'container-fill-progression',
        ],
      };
      for (const check of roleChecks[binding.packageRole] ?? []) {
        if (!request.quality?.requiredChecks?.includes(check)) {
          errors.push(
            `container ${binding.packageRole} request 必须包含质量检查 ${check}`,
          );
        }
      }
    }
  }
  if (request?.semanticBinding !== undefined) {
    if (request.capability !== 'image') errors.push('只有 image request 可以声明 semanticBinding');
    const binding = request.semanticBinding;
    if (!SEMANTIC_RISK_CLASSES.includes(binding.riskClass)) errors.push('semanticBinding.riskClass 无效');
    if (!Array.isArray(binding.contractIds)) errors.push('semanticBinding.contractIds 必须是数组');
    if (binding.riskClass === 'decorative' && binding.contractIds?.length > 0) {
      errors.push('decorative 图像不得绑定关键 semantic contract');
    }
    if (binding.riskClass !== 'decorative' && binding.contractIds?.length === 0) {
      errors.push('高风险图像必须绑定至少一个 semantic contract');
    }
    if (binding.riskClass === 'identity-critical') {
      if (!isPlainObject(binding.generationFamily)) {
        errors.push('identity-critical 必须声明独立的 generationFamily');
      } else if (
        !binding.generationFamily.familyId ||
        !Array.isArray(binding.generationFamily.identityMemberIds) ||
        binding.generationFamily.identityMemberIds.length === 0 ||
        !Array.isArray(binding.generationFamily.referenceAssetIds)
      ) {
        errors.push('generationFamily 必须声明 familyId、identityMemberIds 和 referenceAssetIds');
      }
    }
    const requiredSemanticChecks = requiredChecksForSemanticBinding(binding);
    if (
      request.quality?.requiredChecks &&
      requiredSemanticChecks.some((check) => !request.quality.requiredChecks.includes(check))
    ) {
      errors.push('quality.requiredChecks 不得省略 riskClass 要求的语义检查');
    }
  }
  if (
    request?.capability === 'image' &&
    request.outputSurface?.mode === 'layer-sheet' &&
    (
      request.layerPackageBinding?.sourceStrategy !== 'registered-layer-sheet' ||
      request.layerPackageBinding?.packageRole !== 'registered-sheet'
    )
  ) {
    errors.push('layer-sheet outputSurface 只能用于 registered-layer-sheet provider root');
  }
  if (errors.length) throw new Error(`资产请求无效：${errors.join('；')}`);
  return request;
};

export const loadAssetRequest = async (requestInput) => {
  const file = resolveWorkspacePath(requestInput, 'request 路径');
  const request = validateAssetRequest(await readJson(file));
  if (request.capability === 'image') {
    const projectFile = path.join(
      ROOT,
      'projects',
      request.projectSlug,
      'project.json',
    );
    if (!(await fileExists(projectFile))) {
      throw new Error('image request 缺少当前 project.json，无法验证 styleProfileBinding');
    }
    const project = await readJson(projectFile);
    if (!project.styleProfile) {
      throw new Error('image request 只能在项目确认 executable styleProfile 后执行');
    }
    assertScenarioRootRequest({
      request,
      scenarioBinding: project.plan?.scenarioBinding ?? null,
    });
    const expectedStyleBinding = styleProfileBinding(project.styleProfile);
    if (
      JSON.stringify(stableValue(request.styleProfileBinding)) !==
      JSON.stringify(stableValue(expectedStyleBinding))
    ) {
      throw new Error(
        'styleProfileBinding 与当前 project.styleProfile 不一致；请重新生成请求',
      );
    }
    const missingDirectives = expectedStyleBinding.directives.filter(
      (directive) => !request.prompt.includes(directive),
    );
    if (missingDirectives.length > 0) {
      throw new Error(
        `image request.prompt 未执行当前 Style Profile 指令：${missingDirectives.join('；')}`,
      );
    }
    const missingStyleChecks =
      project.styleProfile.quality.requiredAssetChecks.filter(
        (check) => !request.quality.requiredChecks.includes(check),
      );
    if (missingStyleChecks.length > 0) {
      throw new Error(
        `quality.requiredChecks 缺少当前 Style Profile 检查：${missingStyleChecks.join(', ')}`,
      );
    }
  }
  await assertRequestSemanticContracts(request);
  if (request.layerPackageBinding) {
    const storyboardFile = path.join(
      ROOT,
      'projects',
      request.projectSlug,
      'storyboard.json',
    );
    if (!(await fileExists(storyboardFile))) {
      throw new Error(
        'layer package provider request 缺少已编译 storyboard，不能在规划前调用 provider',
      );
    }
    const storyboard = await readJson(storyboardFile);
    const plan =
      storyboard.directingSummary?.generationBudget?.sourcePackagePlans?.find(
        ({id}) =>
          id === request.layerPackageBinding.sourcePackageId,
      );
    const binding = request.layerPackageBinding;
    if (
      !plan ||
      plan.pattern !== binding.pattern ||
      plan.motionCapability !== binding.motionCapability ||
      plan.sourceStrategy !== binding.sourceStrategy ||
      plan.targetId !== request.compositionBinding.nodeId
    ) {
      throw new Error(
        'layerPackageBinding 必须与当前 storyboard 编译出的 source package 完全一致',
      );
    }
  }
  if (
    request.capability === 'image' &&
    request.compositionBinding?.pattern === 'looping-environment'
  ) {
    const storyboardFile = path.join(
      ROOT,
      'projects',
      request.projectSlug,
      'storyboard.json',
    );
    const reportFile = path.join(
      ROOT,
      'projects',
      request.projectSlug,
      'world-topology-proof.json',
    );
    if (
      !(await fileExists(storyboardFile)) ||
      !(await fileExists(reportFile))
    ) {
      throw new Error(
        'looping-environment provider request 前必须运行 project:world-topology-proof。',
      );
    }
    assertWorldTopologyBinding({
      request,
      storyboard: await readJson(storyboardFile),
      report: await readJson(reportFile),
    });
  }
  if (request.containerPackageBinding) {
    const storyboardFile = path.join(
      ROOT,
      'projects',
      request.projectSlug,
      'storyboard.json',
    );
    if (!(await fileExists(storyboardFile))) {
      throw new Error(
        'canonical container provider request 缺少已编译 storyboard，不能在规划前调用 provider',
      );
    }
    const storyboard = await readJson(storyboardFile);
    const binding = request.containerPackageBinding;
    const plan =
      storyboard.directingSummary?.generationBudget
        ?.sourcePackagePlans?.find(
          ({id}) => id === binding.sourcePackageId,
        );
    if (
      !plan ||
      plan.pattern !== 'canonical-container' ||
      plan.groupId !== request.compositionBinding.nodeId ||
      !canonicalContainerPackageBindingMatchesPlan({
        binding,
        plan,
      })
    ) {
      throw new Error(
        'containerPackageBinding 必须与当前 storyboard 编译出的 canonical container source package 完全一致',
      );
    }
  }
  if (request.stateSheetRecoveryBinding) {
    const manifestFile = path.join(ROOT, 'projects', request.projectSlug, 'assets-manifest.json');
    if (!(await fileExists(manifestFile))) throw new Error('状态表恢复请求缺少 assets-manifest.json，无法证明完整原表上下文');
    const manifest = assertAssetManifest(await readJson(manifestFile), request.projectSlug);
    const source = manifest.assets?.find(({assetId, lifecycle}) =>
      assetId === request.stateSheetRecoveryBinding.sourceSheetAssetId &&
      ['active', 'recovery-source'].includes(lifecycle?.status));
    const sourceBinding = source?.stateSheetBinding ?? source?.request?.stateSheetBinding ?? null;
    if (
      source?.capability !== 'image' ||
      !sourceBinding ||
      !validRecoveryPolicy(sourceBinding.recoveryPolicy) ||
      sourceBinding.poseFamilyId !== request.stateSheetBinding.poseFamilyId ||
      sourceBinding.registrationId !== request.stateSheetBinding.registrationId ||
      sourceBinding.sourceMasterAssetId !== request.stateSheetBinding.sourceMasterAssetId ||
      sourceBinding.layout?.columns !== request.stateSheetBinding.layout.columns ||
      sourceBinding.layout?.rows !== request.stateSheetBinding.layout.rows ||
      !sameMembers(sourceBinding.states?.map(({stateId}) => stateId) ?? [], request.stateSheetBinding.states.map(({stateId}) => stateId))
    ) {
      throw new Error('状态表恢复来源必须是已登记的同一完整姿态族状态表');
    }
    const sourceFile = resolveWorkspacePath(source.file, '状态表恢复来源');
    if (!(await fileExists(sourceFile))) throw new Error('状态表恢复来源文件不存在');
    if (source.assetId === request.assetId || sourceFile === resolveWorkspacePath(request.output, '状态表恢复输出')) throw new Error('状态表恢复必须写入新资产，不能覆盖用于一致性证明的完整原表');
    if (request.stateSheetRecoveryBinding.mode === 'masked-sheet-edit') {
      const mask = manifest.assets?.find(({assetId, lifecycle}) =>
        assetId === request.stateSheetRecoveryBinding.maskAssetId && lifecycle?.status === 'active');
      const maskFile = mask?.file ? resolveWorkspacePath(mask.file, '状态表恢复遮罩') : null;
      if (!maskFile || mask.capability !== 'image' || !(await fileExists(maskFile))) throw new Error('masked-sheet-edit 必须引用已登记且存在的完整画布遮罩');
      const [sourceMetadata, maskMetadata] = await Promise.all([sharp(sourceFile).metadata(), sharp(maskFile).metadata()]);
      if (!sourceMetadata.width || !sourceMetadata.height || sourceMetadata.width !== maskMetadata.width || sourceMetadata.height !== maskMetadata.height) throw new Error('状态表恢复遮罩必须与完整原表尺寸一致');
      const maskInspection = await inspectStateSheetRecoveryMask({maskFile, stateSheetBinding: request.stateSheetBinding, recoveryBinding: request.stateSheetRecoveryBinding});
      if (!maskInspection.passed) throw new Error(`状态表恢复遮罩越过目标格或为空：${JSON.stringify(maskInspection)}`);
    }
  }
  const output = resolveWorkspacePath(request.output, 'output 路径');
  return {file, request, output};
};

export const expandCommandTemplate = (value, context) =>
  String(value).replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key) =>
    Object.hasOwn(context, key) ? String(context[key] ?? '') : match,
  );

export const makeCommandContext = ({requestFile, request, output}) => ({
  request: requestFile,
  output,
  prompt: request.prompt ?? '',
  text: request.text ?? '',
  voiceId: request.voiceId ?? '',
  model: request.model ?? '',
  settingsJson: JSON.stringify(request.settings ?? {}),
  projectSlug: request.projectSlug,
  projectDir: path.join(ROOT, 'projects', request.projectSlug),
  assetId: request.assetId,
  capability: request.capability,
  workspace: ROOT,
});

export const runProviderCommand = (command, commandArgs, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      env: process.env,
      stdio: options.stdio ?? 'inherit',
      shell: false,
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`provider command 超过 ${options.timeoutSeconds}s`));
    }, options.timeoutSeconds * 1000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });

export const verifyOutputFile = async (file, request = null) => {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size < 1) {
    throw new Error(`provider 未生成有效输出：${path.relative(ROOT, file)}`);
  }
  let metadata = null;
  let keyPlaneObservation = null;
  let providerSourceObservation = null;
  if (request?.capability === 'image') {
    metadata = await sharp(file).metadata().catch(() => null);
    if (!metadata?.width || !metadata?.height) {
      throw new Error(`provider 图像尺寸不可读：${path.relative(ROOT, file)}`);
    }
    if (request.schemaVersion >= 3) {
      const expected = request.compositionBinding.canvas;
      const providerSourcePolicy = request.providerSource ?? null;
      const providerSource =
        request.layerPackageBinding?.sheetLayout?.providerSource ?? null;
      const stateSheetLayout = request.stateSheetBinding?.layout ?? null;
      const stateSheetUsesProviderNativeCanvas =
        stateSheetLayout &&
        metadata.width >= expected.width &&
        metadata.height >= expected.height &&
        metadata.width % stateSheetLayout.columns === 0 &&
        metadata.height % stateSheetLayout.rows === 0 &&
        Math.abs(
          metadata.width / metadata.height -
          expected.width / expected.height,
        ) <= 0.002;
      if (
        providerSource?.canvasMode === 'provider-native' &&
        (
          metadata.width < providerSource.minimumWidth ||
          metadata.height < providerSource.minimumHeight
        )
      ) {
        throw new Error(
          `provider 原生 sheet 画布 ${metadata.width}x${metadata.height} 小于声明下限 ` +
          `${providerSource.minimumWidth}x${providerSource.minimumHeight}。`,
        );
      }
      if (
        providerSource?.canvasMode !== 'provider-native' &&
        providerSourcePolicy?.mode !== 'provider-native' &&
        !stateSheetUsesProviderNativeCanvas &&
        (metadata.width !== expected.width || metadata.height !== expected.height)
      ) {
        throw new Error(
          `provider 图像尺寸 ${metadata.width}x${metadata.height} 与请求画布 ${expected.width}x${expected.height} 不一致。`,
        );
      }
      if (providerSourcePolicy?.mode === 'provider-native') {
        const actualAspect = metadata.width / metadata.height;
        const targetAspect = expected.width / expected.height;
        if (
          metadata.width < providerSourcePolicy.minimumWidth ||
          metadata.height < providerSourcePolicy.minimumHeight ||
          Math.abs(actualAspect - targetAspect) >
            providerSourcePolicy.aspectRatioTolerance
        ) {
          throw new Error(
            `provider 原生画布 ${metadata.width}x${metadata.height} 不满足最小尺寸或宽高比容差；` +
            `目标 ${expected.width}x${expected.height}，容差 ${providerSourcePolicy.aspectRatioTolerance}。`,
          );
        }
        const observation = {
          schemaVersion: 1,
          mode: 'provider-native',
          rawCanvas: {width: metadata.width, height: metadata.height},
          targetCanvas: {
            width: providerSourcePolicy.normalization.targetCanvas.width,
            height: providerSourcePolicy.normalization.targetCanvas.height,
          },
          normalization: 'deterministic-resize',
          normalizationRequired:
            metadata.width !== expected.width ||
            metadata.height !== expected.height,
        };
        providerSourceObservation = {
          ...observation,
          observationFingerprint: createHash('sha256')
            .update(JSON.stringify(stableValue(observation)))
            .digest('hex'),
        };
      }
    }
    const surface = request.outputSurface;
    if (surface?.mode === 'alpha') {
      const pixels = await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject: true});
      const alphaOffset = pixels.info.channels - 1;
      let transparentPixels = 0;
      for (let offset = alphaOffset; offset < pixels.data.length; offset += pixels.info.channels) {
        if (pixels.data[offset] < 250) transparentPixels += 1;
      }
      if (!metadata.hasAlpha || transparentPixels === 0) {
        throw new Error(
          'provider 图像未提供真实透明像素；alpha 输出不能是烘焙棋盘格或全不透明图。',
        );
      }
    } else if (surface?.mode === 'opaque' && metadata.hasAlpha) {
      const pixels = await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject: true});
      const alphaOffset = pixels.info.channels - 1;
      for (let offset = alphaOffset; offset < pixels.data.length; offset += pixels.info.channels) {
        if (pixels.data[offset] !== 255) {
          throw new Error('provider 图像声明 opaque，但输出含透明或半透明像素。');
        }
      }
    } else if (surface?.mode === 'chroma-key') {
      const pixels = await sharp(file).removeAlpha().raw().toBuffer({resolveWithObject: true});
      const {width, height, channels} = pixels.info;
      if (surface.keyPlane?.mode === OBSERVED_KEY_PLANE_MODE) {
        const observation = inspectObservedKeyPlanePixels({
          data: pixels.data,
          imageWidth: width,
          imageHeight: height,
          channels,
          requestedKeyColor: surface.keyColor,
        });
        assertObservedKeyPlaneSet({
          observations: [{packageRole: 'image', ...observation}],
        });
        keyPlaneObservation = {
          mode: OBSERVED_KEY_PLANE_MODE,
          policyId: OBSERVED_KEY_PLANE_POLICY_ID,
          policyFingerprint: observedKeyPlanePolicyFingerprint(),
          cells: [{packageRole: 'image', ...observation}],
        };
      } else {
        const rgb = surface.keyColor.slice(1).match(/.{2}/g).map((part) => Number.parseInt(part, 16));
        const tolerance = surface.tolerance ?? 24;
        const boundary = [];
        for (let x = 0; x < width; x += 1) {
          boundary.push([x, 0], [x, height - 1]);
        }
        for (let y = 1; y < height - 1; y += 1) {
          boundary.push([0, y], [width - 1, y]);
        }
        const matches = boundary.filter(([x, y]) => {
          const offset = (y * width + x) * channels;
          return rgb.every((value, channel) =>
            Math.abs(pixels.data[offset + channel] - value) <= tolerance);
        }).length;
        if (matches / boundary.length < 0.8) {
          throw new Error(
            `provider 图像边界未形成可靠色键面：仅 ${matches}/${boundary.length} 像素匹配 ${surface.keyColor}。`,
          );
        }
      }
    } else if (surface?.mode === 'layer-sheet') {
      const layout = request.layerPackageBinding?.sheetLayout;
      if (layout?.columns !== 2 || layout?.rows !== 2) {
        throw new Error('layer-sheet 输出缺少正式 2x2 sheetLayout。');
      }
      const pixels = await sharp(file)
        .ensureAlpha()
        .raw()
        .toBuffer({resolveWithObject: true});
      const {width, height, channels} = pixels.info;
      const observedCells = [];
      for (const cell of layout.cells ?? []) {
        const cellSurface = cell.outputSurface;
        const left = Math.floor(cell.column * width / layout.columns);
        const right = Math.floor((cell.column + 1) * width / layout.columns);
        const top = Math.floor(cell.row * height / layout.rows);
        const bottom = Math.floor((cell.row + 1) * height / layout.rows);
        let transparent = 0;
        let keyed = 0;
        const total = Math.max(1, (right - left) * (bottom - top));
        const key = cellSurface?.mode === 'chroma-key'
          ? cellSurface.keyColor
            .slice(1)
            .match(/.{2}/g)
            .map((part) => Number.parseInt(part, 16))
          : null;
        const tolerance = cellSurface?.tolerance ?? 24;
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) {
            const offset = (y * width + x) * channels;
            if (pixels.data[offset + channels - 1] < 250) transparent += 1;
            if (
              key?.every(
                (value, channel) =>
                  Math.abs(pixels.data[offset + channel] - value) <= tolerance,
              )
            ) {
              keyed += 1;
            }
          }
        }
        if (cellSurface?.mode === 'alpha' && transparent / total < 0.08) {
          throw new Error(
            `registered-layer-sheet ${cell.packageRole} 格未提供足够真实透明像素。`,
          );
        }
        if (cellSurface?.mode === 'chroma-key') {
          if (cellSurface.keyPlane?.mode === OBSERVED_KEY_PLANE_MODE) {
            observedCells.push({
              packageRole: cell.packageRole,
              ...inspectObservedKeyPlanePixels({
                data: pixels.data,
                imageWidth: width,
                imageHeight: height,
                channels,
                rect: {
                  left,
                  top,
                  width: right - left,
                  height: bottom - top,
                },
                requestedKeyColor: cellSurface.keyColor,
              }),
            });
          } else if (keyed / total < 0.08) {
            throw new Error(
              `registered-layer-sheet ${cell.packageRole} 格没有形成声明的纯色色键面 ` +
              `${cellSurface.keyColor}；匹配比例 ${(keyed / total).toFixed(4)}。`,
            );
          }
        }
      }
      if (observedCells.length > 0) {
        try {
          assertObservedKeyPlaneSet({observations: observedCells});
        } catch (error) {
          throw new Error(`provider-native observed key plane 不合格：${error.message}`);
        }
        keyPlaneObservation = {
          mode: OBSERVED_KEY_PLANE_MODE,
          policyId: OBSERVED_KEY_PLANE_POLICY_ID,
          policyFingerprint: observedKeyPlanePolicyFingerprint(),
          cells: observedCells,
        };
      }
    }
  } else if (
    request?.capability === 'voice' ||
    request?.capability === 'sound'
  ) {
    const probe = await probeMedia(file).catch(() => null);
    const audio = probe?.streams?.find(({codec_type: type}) => type === 'audio');
    const durationSeconds = Number(probe?.format?.duration ?? 0);
    if (!audio || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error(`provider 音频媒体不可读：${path.relative(ROOT, file)}`);
    }
    const minimum = request.timingBinding?.minDurationSeconds;
    const maximum = request.timingBinding?.maxDurationSeconds;
    if (Number.isFinite(minimum) && durationSeconds < minimum) {
      throw new Error(
        `provider 语音 ${durationSeconds.toFixed(3)}s 短于 ${request.timingBinding.sceneId} 允许的最短 ${minimum}s；请补充文案或调整语速后重新生成。`,
      );
    }
    if (Number.isFinite(maximum) && durationSeconds > maximum) {
      throw new Error(
        `provider 语音 ${durationSeconds.toFixed(3)}s 超过 ${request.timingBinding.sceneId} 允许的最长 ${maximum}s；请压缩文案或提高语速后重新生成。`,
      );
    }
    metadata = {
      durationSeconds,
      codec: audio.codec_name ?? null,
      sampleRate: Number(audio.sample_rate ?? 0) || null,
      channels: audio.channels ?? null,
    };
  }
  return {
    stat,
    metadata,
    keyPlaneObservation,
    providerSourceObservation,
  };
};

const compositionFamilyKey = (asset) => {
  const binding = asset.compositionBinding;
  if (!binding) return null;
  return [
    binding.pattern,
    binding.registrationId ?? asset.assetId,
    binding.sourceMasterAssetId ?? asset.assetId,
    binding.canvas?.width,
    binding.canvas?.height,
  ].join(':');
};

export const refreshActiveCompositionFamilyFingerprints = (
  manifest,
  {familyKey = compositionFamilyKey} = {},
) => {
  const activeAssets = manifest.assets.filter(
    ({lifecycle}) => lifecycle.status === 'active',
  );
  const familyKeys = new Set(activeAssets.map(familyKey).filter(Boolean));
  for (const key of familyKeys) {
    const members = activeAssets
      .filter((asset) => familyKey(asset) === key)
      .sort((left, right) => left.assetId.localeCompare(right.assetId));
    const familyFingerprint = createHash('sha256')
      .update(JSON.stringify(stableValue({
        key,
        members: members.map(({
          assetId,
          sha256: memberSha256,
          requestFingerprint,
          compositionBinding,
          stateBinding,
        }) => ({
          assetId,
          sha256: memberSha256,
          requestFingerprint,
          compositionBinding,
          stateBinding,
        })),
      })))
      .digest('hex');
    for (const member of members) {
      member.familyFingerprint =
        member.registeredFamilyBinding?.familyFingerprint ??
        familyFingerprint;
    }
  }
  return manifest;
};

export const recordAssetProvenance = async ({
  request,
  output,
  provider,
  model = null,
  externalId = null,
  reusedFrom = null,
  attemptId = null,
  recoverClosedAttempt = false,
}) => {
  const trackedAttempt =
    request.schemaVersion >= 3 &&
    isQuotaConsumingImageRequest(request) &&
    provider.adapter !== 'manual' &&
    !reusedFrom;
  const canonicalModel = normalizeAttemptModel({
    provider,
    model:
      model ??
      request.model ??
      provider.invocation?.modelValue ??
      provider.model ??
      null,
  });
  let trackedAttemptRecord = null;
  if (trackedAttempt) {
    const asserted = recoverClosedAttempt
      ? await assertRecoverableGenerationAttempt({
          request,
          provider,
          attemptId,
          model: canonicalModel,
        })
      : await assertReservedGenerationAttempt({
          request,
          provider,
          attemptId,
          model: canonicalModel,
        });
    trackedAttemptRecord = asserted.attempt;
  }
  let stat;
  let metadata;
  let keyPlaneObservation;
  let providerSourceObservation;
  let sha256;
  try {
    sha256 = createHash('sha256').update(await fs.readFile(output)).digest('hex');
    ({
      stat,
      metadata,
      keyPlaneObservation,
      providerSourceObservation,
    } = await verifyOutputFile(output, request));
  } catch (error) {
    if (trackedAttempt && !recoverClosedAttempt) {
      await closeGenerationAttempt({
        slug: request.projectSlug,
        attemptId,
        status: 'rejected',
        quotaConsumed: true,
        output: path.relative(ROOT, output),
        outputSha256: sha256 ?? null,
        note: error.message,
      });
    }
    throw error;
  }
  const manifestFile = path.join(ROOT, 'projects', request.projectSlug, 'assets-manifest.json');
  let record;
  try {
    const transaction = await transactAssetManifest({
      manifestFile,
      projectSlug: request.projectSlug,
      createIfMissing: true,
      mutate: async (manifest) => {
        if (
          recoverClosedAttempt &&
          manifest.assets.some((asset) => asset.attemptId === attemptId)
        ) {
          throw new Error(`生成尝试 ${attemptId} 已经存在资产登记，不能重复恢复。`);
        }
        if (recoverClosedAttempt) {
          await assertRecoverableGenerationAttempt({
            request,
            provider,
            attemptId,
            model: canonicalModel,
            output: path.relative(ROOT, output),
            outputSha256: sha256,
          });
        }
        const actualModel = trackedAttemptRecord?.model ?? canonicalModel;
        const recordedAt = new Date().toISOString();
        const requestFingerprint = createRequestFingerprint({
          request,
          providerId: provider.id,
          model: actualModel,
        });
        const providerObservation = keyPlaneObservation
          ? {
              schemaVersion: 1,
              ...keyPlaneObservation,
              observationFingerprint: createHash('sha256')
                .update(JSON.stringify(stableValue({
                  policyFingerprint: keyPlaneObservation.policyFingerprint,
                  sourceSha256: sha256,
                  cells: keyPlaneObservation.cells,
                })))
                .digest('hex'),
              sourceAttempt: {
                attemptId,
                status: 'succeeded',
                quotaConsumed: true,
                requestFingerprint: generationRequestFingerprint(request),
                output: path.relative(ROOT, output),
              },
            }
          : null;
        const nextRecord = {
          recordId: createAssetRecordId({
            assetId: request.assetId,
            requestFingerprint,
            sha256,
            recordedAt,
          }),
          assetId: request.assetId,
          capability: request.capability,
          file: path.relative(ROOT, output),
          provider: provider.id,
          adapter: provider.adapter,
          tool: provider.tool ?? null,
          model: actualModel,
          externalId: externalId || null,
          attemptId,
          recoveredFromClosedAttempt: recoverClosedAttempt,
          requestFingerprint,
          reusedFrom,
          sha256,
          sizeBytes: stat.size,
          media: metadata
            ? request.capability === 'image'
              ? {width: metadata.width, height: metadata.height, format: metadata.format ?? null, hasAlpha: metadata.hasAlpha ?? false}
              : metadata
            : null,
          recordedAt,
          request: {...request},
          providerSource: providerSourceObservation,
          compositionBinding: request.compositionBinding ?? null,
          stateBinding: request.stateBinding ?? null,
          stateSheetBinding: request.stateSheetBinding ?? null,
          stateSheetRecoveryBinding: request.stateSheetRecoveryBinding ?? null,
          containerPackageBinding:
            request.containerPackageBinding ?? null,
          semanticBinding: request.semanticBinding ?? null,
          providerObservation,
          familyFingerprint: null,
          lifecycle: {
            status: 'active',
            changedAt: recordedAt,
            reason: 'recorded',
            supersededBy: null,
          },
        };
        for (const previous of manifest.assets.filter(({assetId, lifecycle}) =>
          assetId === request.assetId && lifecycle.status === 'active')) {
          previous.lifecycle = {
            status: 'superseded',
            changedAt: recordedAt,
            reason: 'replaced-by-new-record',
            supersededBy: nextRecord.recordId,
          };
        }
        manifest.assets.push(nextRecord);
        refreshActiveCompositionFamilyFingerprints(manifest);
        return {manifest, record: nextRecord};
      },
    });
    record = transaction.record;
  } catch (error) {
    if (trackedAttempt && !recoverClosedAttempt) {
      await closeGenerationAttempt({
        slug: request.projectSlug,
        attemptId,
        status: 'abandoned',
        quotaConsumed: true,
        output: path.relative(ROOT, output),
        outputSha256: sha256,
        note: `输出有效但溯源登记失败：${error.message}`,
      });
    }
    throw error;
  }
  if (trackedAttempt && !recoverClosedAttempt) {
    await closeGenerationAttempt({
      slug: request.projectSlug,
      attemptId,
      status: 'succeeded',
      quotaConsumed: true,
      output: path.relative(ROOT, output),
      outputSha256: sha256,
    });
  }
  return {manifestFile, record, attemptId};
};
