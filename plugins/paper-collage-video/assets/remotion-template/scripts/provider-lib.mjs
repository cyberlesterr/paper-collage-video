import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT, SLUG_PATTERN, fileExists, readJson, writeJson} from './project-lib.mjs';

export const PROVIDER_CAPABILITIES = ['text', 'image', 'voice'];
export const PROVIDER_ADAPTERS = ['host', 'command', 'manual'];

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

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
  if (request?.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
  if (!SLUG_PATTERN.test(request?.projectSlug ?? '')) errors.push('projectSlug 格式无效');
  if (!SLUG_PATTERN.test(request?.assetId ?? '')) errors.push('assetId 格式无效');
  if (!PROVIDER_CAPABILITIES.includes(request?.capability)) errors.push('capability 必须是 text、image 或 voice');
  if (!request?.output || typeof request.output !== 'string') errors.push('output 不能为空');
  if (request?.capability === 'text' && !request.prompt) errors.push('text request 缺少 prompt');
  if (request?.capability === 'image' && !request.prompt) errors.push('image request 缺少 prompt');
  if (request?.capability === 'voice' && !request.text) errors.push('voice request 缺少 text');
  if (errors.length) throw new Error(`资产请求无效：${errors.join('；')}`);
  return request;
};

export const loadAssetRequest = async (requestInput) => {
  const file = resolveWorkspacePath(requestInput, 'request 路径');
  const request = validateAssetRequest(await readJson(file));
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

export const verifyOutputFile = async (file) => {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size < 1) {
    throw new Error(`provider 未生成有效输出：${path.relative(ROOT, file)}`);
  }
  return stat;
};

export const recordAssetProvenance = async ({
  request,
  output,
  provider,
  model = null,
  externalId = null,
}) => {
  const stat = await verifyOutputFile(output);
  const sha256 = createHash('sha256').update(await fs.readFile(output)).digest('hex');
  const manifestFile = path.join(ROOT, 'projects', request.projectSlug, 'assets-manifest.json');
  const manifest = (await fileExists(manifestFile))
    ? await readJson(manifestFile)
    : {
        $schema: '../../schemas/assets-manifest.schema.json',
        schemaVersion: 1,
        projectSlug: request.projectSlug,
        assets: [],
      };
  if (manifest.projectSlug !== request.projectSlug || !Array.isArray(manifest.assets)) {
    throw new Error(`资产清单无效：${path.relative(ROOT, manifestFile)}`);
  }
  const record = {
    assetId: request.assetId,
    capability: request.capability,
    file: path.relative(ROOT, output),
    provider: provider.id,
    adapter: provider.adapter,
    model: model || request.model || provider.model || null,
    externalId: externalId || null,
    sha256,
    sizeBytes: stat.size,
    recordedAt: new Date().toISOString(),
    request: {...request},
  };
  manifest.assets = [
    ...manifest.assets.filter(({assetId}) => assetId !== request.assetId),
    record,
  ];
  await writeJson(manifestFile, manifest);
  return {manifestFile, record};
};
