import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {ROOT, SLUG_PATTERN, fileExists, readJson, writeJson} from './project-lib.mjs';
import {
  SEMANTIC_RISK_CLASSES,
  assertRequestSemanticContracts,
  requiredChecksForSemanticBinding,
} from './semantic-contract-lib.mjs';
import {
  assertReservedGenerationAttempt,
  closeGenerationAttempt,
  generationAttemptsPath,
  isQuotaConsumingImageRequest,
} from './generation-attempt-lib.mjs';

export const PROVIDER_CAPABILITIES = ['text', 'image', 'voice'];
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
  'subject-complete',
  'identity-consistent',
  'identity-distinct-within-frame',
  'identity-family-consistent',
  'cross-scene-identity-continuity',
  'cell-separation',
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
];
const PROVIDER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

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
    compositionBinding: request.compositionBinding ?? null,
    semanticBinding: request.semanticBinding ?? null,
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
  for (const capability of PROVIDER_CAPABILITIES) {
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

export const assertProviderSelections = (loaded) => {
  assertProviderConfig(loaded);
  const selections = summarizeProviderSelections(loaded.config);
  const missing = Object.entries(selections)
    .filter(([, status]) => !status.confirmed)
    .map(([capability]) => capability);
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

export const assertSelectedProvidersReady = async (slug) => {
  const loaded = assertProviderSelections(await loadProviderConfig(slug));
  for (const capability of PROVIDER_CAPABILITIES) {
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
    } = input;
    if (!PROVIDER_CAPABILITIES.includes(capability)) {
      throw new Error(`capability 必须是：${PROVIDER_CAPABILITIES.join(', ')}。`);
    }
    if (!PROVIDER_ID_PATTERN.test(providerId ?? '')) {
      throw new Error('provider id 只能包含小写字母、数字和单个连字符。');
    }
    const existing =
      prospectiveConfig.capabilities[capability].providers[providerId] ?? null;
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
    };
    if (provider.adapter === 'host' && capability !== 'text' && !provider.tool) {
      throw new Error('host image/voice provider 必须记录已发现的可调用 tool。');
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
    if (!existing || label || adapter || tool || model) {
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

export const validateAssetRequest = (request) => {
  const errors = [];
  if (![2, 3].includes(request?.schemaVersion)) errors.push('schemaVersion 必须为 2 或 3');
  if (!SLUG_PATTERN.test(request?.projectSlug ?? '')) errors.push('projectSlug 格式无效');
  if (!SLUG_PATTERN.test(request?.assetId ?? '')) errors.push('assetId 格式无效');
  if (!PROVIDER_CAPABILITIES.includes(request?.capability)) errors.push('capability 必须是 text、image 或 voice');
  if (!request?.output || typeof request.output !== 'string') errors.push('output 不能为空');
  if (request?.capability === 'text' && !request.prompt) errors.push('text request 缺少 prompt');
  if (request?.capability === 'image' && !request.prompt) errors.push('image request 缺少 prompt');
  if (request?.capability === 'image' && !isPlainObject(request.compositionBinding)) {
    errors.push('image request 缺少 compositionBinding');
  }
  if (request?.capability === 'image' && request.schemaVersion === 3 && !isPlainObject(request.semanticBinding)) {
    errors.push('schema-v3 image request 缺少 semanticBinding');
  }
  if (request?.capability === 'voice' && !request.text) errors.push('voice request 缺少 text');
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
    if (!['free', 'supported-subject', 'registered-environment'].includes(binding.pattern)) errors.push('compositionBinding.pattern 无效');
    if (!Number.isInteger(binding.canvas?.width) || binding.canvas.width < 1 || !Number.isInteger(binding.canvas?.height) || binding.canvas.height < 1) errors.push('compositionBinding.canvas 无效');
    if (!['provider-generation', 'provider-edit', 'alpha-extraction', 'crop', 'mask-application', 'manual-import'].includes(binding.derivation?.method)) errors.push('compositionBinding.derivation.method 无效');
    if (['supported-subject', 'registered-environment'].includes(binding.pattern) && (!binding.registrationId || !binding.sourceMasterAssetId)) errors.push('耦合素材必须声明 registrationId 和 sourceMasterAssetId');
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
        !Array.isArray(binding.generationFamily.memberIds) ||
        binding.generationFamily.memberIds.length === 0 ||
        !Array.isArray(binding.generationFamily.referenceAssetIds)
      ) {
        errors.push('generationFamily 必须声明 familyId、memberIds 和 referenceAssetIds');
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
  if (errors.length) throw new Error(`资产请求无效：${errors.join('；')}`);
  return request;
};

export const loadAssetRequest = async (requestInput) => {
  const file = resolveWorkspacePath(requestInput, 'request 路径');
  const request = validateAssetRequest(await readJson(file));
  if (
    request.capability === 'image' &&
    request.schemaVersion < 3 &&
    await fileExists(generationAttemptsPath(request.projectSlug))
  ) {
    throw new Error('启用生成尝试账本的新项目必须使用 schema-v3 image request。');
  }
  await assertRequestSemanticContracts(request);
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
  if (request?.capability === 'image') {
    metadata = await sharp(file).metadata().catch(() => null);
    if (!metadata?.width || !metadata?.height) {
      throw new Error(`provider 图像尺寸不可读：${path.relative(ROOT, file)}`);
    }
    if (request.schemaVersion >= 3) {
      const expected = request.compositionBinding.canvas;
      if (metadata.width !== expected.width || metadata.height !== expected.height) {
        throw new Error(
          `provider 图像尺寸 ${metadata.width}x${metadata.height} 与请求画布 ${expected.width}x${expected.height} 不一致。`,
        );
      }
    }
  }
  return {stat, metadata};
};

export const recordAssetProvenance = async ({
  request,
  output,
  provider,
  model = null,
  externalId = null,
  reusedFrom = null,
  attemptId = null,
}) => {
  const trackedAttempt =
    request.schemaVersion >= 3 &&
    isQuotaConsumingImageRequest(request) &&
    !reusedFrom;
  if (trackedAttempt) {
    await assertReservedGenerationAttempt({request, provider, attemptId});
  }
  let stat;
  let metadata;
  let sha256;
  try {
    ({stat, metadata} = await verifyOutputFile(output, request));
    sha256 = createHash('sha256').update(await fs.readFile(output)).digest('hex');
  } catch (error) {
    if (trackedAttempt) {
      await closeGenerationAttempt({
        slug: request.projectSlug,
        attemptId,
        status: 'rejected',
        quotaConsumed: true,
        output: path.relative(ROOT, output),
        note: error.message,
      });
    }
    throw error;
  }
  const manifestFile = path.join(ROOT, 'projects', request.projectSlug, 'assets-manifest.json');
  let record;
  try {
    const manifest = (await fileExists(manifestFile))
      ? await readJson(manifestFile)
      : {
          $schema: '../../schemas/assets-manifest.schema.json',
          schemaVersion: 3,
          projectSlug: request.projectSlug,
          assets: [],
        };
    if (manifest.projectSlug !== request.projectSlug || !Array.isArray(manifest.assets)) {
      throw new Error(`资产清单无效：${path.relative(ROOT, manifestFile)}`);
    }
    if (manifest.schemaVersion !== 3) {
      throw new Error('assets-manifest.json 必须使用 schemaVersion 3；请重新创建项目。');
    }
    const actualModel = model || request.model || provider.model || null;
    record = {
      assetId: request.assetId,
      capability: request.capability,
      file: path.relative(ROOT, output),
      provider: provider.id,
      adapter: provider.adapter,
      tool: provider.tool ?? null,
      model: actualModel,
      externalId: externalId || null,
      attemptId,
      requestFingerprint: createRequestFingerprint({
        request,
        providerId: provider.id,
        model: actualModel,
      }),
      reusedFrom,
      sha256,
      sizeBytes: stat.size,
      media: metadata ? {width: metadata.width, height: metadata.height, format: metadata.format ?? null, hasAlpha: metadata.hasAlpha ?? false} : null,
      recordedAt: new Date().toISOString(),
      request: {...request},
      compositionBinding: request.compositionBinding ?? null,
      semanticBinding: request.semanticBinding ?? null,
      familyFingerprint: null,
    };
    manifest.assets = [
      ...manifest.assets.filter(({assetId}) => assetId !== request.assetId),
      record,
    ];
    const familyKey = (asset) => {
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
    const familyKeys = new Set(manifest.assets.map(familyKey).filter(Boolean));
    for (const key of familyKeys) {
      const members = manifest.assets
        .filter((asset) => familyKey(asset) === key)
        .sort((left, right) => left.assetId.localeCompare(right.assetId));
      const familyFingerprint = createHash('sha256')
        .update(JSON.stringify(stableValue({
          key,
          members: members.map(({assetId, sha256: memberSha256, requestFingerprint, compositionBinding}) => ({assetId, sha256: memberSha256, requestFingerprint, compositionBinding})),
        })))
        .digest('hex');
      for (const member of members) member.familyFingerprint = familyFingerprint;
    }
    await writeJson(manifestFile, manifest);
  } catch (error) {
    if (trackedAttempt) {
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
  if (trackedAttempt) {
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
