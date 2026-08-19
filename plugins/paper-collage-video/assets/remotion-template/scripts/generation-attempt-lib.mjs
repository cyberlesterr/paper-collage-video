import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256Value} from './contract-utils.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(scriptDirectory, '..');

export const GENERATION_ATTEMPT_STATUSES = [
  'reserved',
  'succeeded',
  'rejected',
  'abandoned',
  'failed-before-generation',
];

export const generationRequestFingerprint = (request) =>
  sha256Value(
    Object.fromEntries(
      Object.entries(request ?? {}).filter(([key]) => key !== '$schema'),
    ),
  );

export const isQuotaConsumingImageRequest = (request) =>
  request?.capability === 'image' &&
  ['provider-generation', 'provider-edit'].includes(
    request.compositionBinding?.derivation?.method,
  );

export const normalizeAttemptModel = ({provider, model}) => {
  const aliases = new Set(provider.invocation?.reportedModelAliases ?? []);
  const configured =
    provider.invocation?.modelValue ?? provider.model ?? null;
  if (!configured) return model ?? null;
  if (!model || model === configured || aliases.has(model)) return configured;
  throw new Error(
    `provider 回报的 model ${model} 未映射到已确认配置 ${configured}。`,
  );
};

const canonicalAttemptModel = ({request, provider, model = null}) =>
  normalizeAttemptModel({
    provider,
    model:
      model ??
      request.model ??
      provider.invocation?.modelValue ??
      provider.model ??
      null,
  });

export const generationAttemptsPath = (slug) =>
  path.join(ROOT, 'projects', slug, 'generation-attempts.jsonl');

export const readGenerationAttemptEvents = async (slug) => {
  const file = generationAttemptsPath(slug);
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return {file, exists: false, events: []};
    throw error;
  }
  const events = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`generation-attempts.jsonl 第 ${index + 1} 行不是有效 JSON。`);
      }
    });
  return {file, exists: true, events};
};

export const reduceGenerationAttempts = (events) => {
  const attempts = new Map();
  for (const event of events) {
    if (event?.schemaVersion !== 1 || !event.attemptId || !event.projectSlug) {
      throw new Error('generation-attempts.jsonl 含无效事件。');
    }
    attempts.set(event.attemptId, {...(attempts.get(event.attemptId) ?? {}), ...event});
  }
  return attempts;
};

export const summarizeGenerationAttempts = (events) => {
  const attempts = [...reduceGenerationAttempts(events).values()];
  const used = attempts.filter(({quotaConsumed}) => quotaConsumed === true).length;
  const reserved = attempts.filter(({status}) => status === 'reserved').length;
  return {
    attempts,
    used,
    reserved,
    closed: attempts.length - reserved,
    byStatus: Object.fromEntries(
      GENERATION_ATTEMPT_STATUSES.map((status) => [
        status,
        attempts.filter((attempt) => attempt.status === status).length,
      ]),
    ),
  };
};

export const readGenerationAttempt = async ({slug, attemptId}) => {
  const loaded = await readGenerationAttemptEvents(slug);
  const attempt = reduceGenerationAttempts(loaded.events).get(attemptId);
  if (!attempt) throw new Error(`生成尝试不存在：${attemptId}`);
  return {file: loaded.file, attempt};
};

const appendEvent = async (file, event) => {
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const withLedgerLock = async (slug, operation) => {
  const file = generationAttemptsPath(slug);
  const lockDirectory = `${file}.lock`;
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.mkdir(lockDirectory);
      acquired = true;
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const stat = await fs.stat(lockDirectory).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 30_000) {
        await fs.rm(lockDirectory, {recursive: true, force: true});
        continue;
      }
      await wait(50);
    }
  }
  if (!acquired) throw new Error('生成尝试账本正被其他进程使用，请稍后重试。');
  try {
    return await operation();
  } finally {
    await fs.rm(lockDirectory, {recursive: true, force: true});
  }
};

export const reserveGenerationAttempt = async ({request, provider, model = null}) => {
  if (!isQuotaConsumingImageRequest(request)) {
    throw new Error('只有 provider-generation/provider-edit 图像请求需要生成额度预留。');
  }
  const projectFile = path.join(ROOT, 'projects', request.projectSlug, 'project.json');
  const project = JSON.parse(await fs.readFile(projectFile, 'utf8'));
  const maximum = project.plan?.approvedImageBudget?.imageAttemptLimit;
  if (!Number.isInteger(maximum) || maximum < 0) {
    throw new Error(
      '人批准的图片尝试上限尚未通过概念审批并写入 approvedImageBudget，不能发起生图。',
    );
  }
  if (maximum === 0) {
    throw new Error('人批准的图片尝试上限为 0，不能发起生图。');
  }
  const requestFingerprint = generationRequestFingerprint(request);
  return withLedgerLock(request.projectSlug, async () => {
    const loaded = await readGenerationAttemptEvents(request.projectSlug);
    const summary = summarizeGenerationAttempts(loaded.events);
    const rejectedTwin = summary.attempts.find(
      (attempt) =>
        attempt.requestFingerprint === requestFingerprint &&
        attempt.status === 'rejected',
    );
    if (rejectedTwin) {
      throw new Error(
        `同一请求已被拒绝并计费（${rejectedTwin.attemptId}）；` +
          '请修改 prompt/参数等真实输入后再预留新的生成尝试。',
      );
    }
    if (summary.used + summary.reserved >= maximum) {
      throw new Error(
        `生成图预算已用尽：${summary.used} 已计费，${summary.reserved} 已预留，批准上限 ${maximum}。`,
      );
    }
    const at = new Date().toISOString();
    const attemptId = `img-${randomUUID()}`;
    const event = {
      schemaVersion: 1,
      attemptId,
      event: 'reserved',
      status: 'reserved',
      projectSlug: request.projectSlug,
      assetId: request.assetId,
      provider: provider.id,
      model: canonicalAttemptModel({request, provider, model}),
      requestFingerprint,
      quotaConsumed: false,
      output: null,
      outputSha256: null,
      note: '',
      at,
    };
    await appendEvent(loaded.file, event);
    return {file: loaded.file, event, budget: {maximum, used: summary.used, reserved: summary.reserved + 1}};
  });
};

export const assertReservedGenerationAttempt = async ({
  request,
  provider,
  attemptId,
  model = null,
}) => {
  if (!attemptId) throw new Error('schema-v3 生图必须提供预留的 --attempt-id。');
  const loaded = await readGenerationAttemptEvents(request.projectSlug);
  const attempt = reduceGenerationAttempts(loaded.events).get(attemptId);
  if (!attempt) throw new Error(`生成尝试不存在：${attemptId}`);
  if (attempt.status !== 'reserved') throw new Error(`生成尝试 ${attemptId} 已关闭为 ${attempt.status}。`);
  if (attempt.assetId !== request.assetId) throw new Error(`生成尝试 ${attemptId} 不属于资产 ${request.assetId}。`);
  if (attempt.provider !== provider.id) throw new Error(`生成尝试 ${attemptId} 的 provider 不匹配。`);
  const expectedModel = canonicalAttemptModel({request, provider, model});
  if (attempt.model !== expectedModel) {
    throw new Error(
      `生成尝试 ${attemptId} 的 model ${attempt.model ?? '(none)'} 与当前已确认模型 ${expectedModel ?? '(none)'} 不匹配。`,
    );
  }
  if (attempt.requestFingerprint !== generationRequestFingerprint(request)) {
    throw new Error(`生成尝试 ${attemptId} 的请求已变化，请重新预留。`);
  }
  return {file: loaded.file, attempt};
};

export const assertRecoverableGenerationAttempt = async ({
  request,
  provider,
  attemptId,
  model = null,
  output = null,
  outputSha256 = null,
}) => {
  const loaded = await readGenerationAttempt({slug: request.projectSlug, attemptId});
  const {attempt} = loaded;
  if (attempt.status !== 'succeeded' || attempt.quotaConsumed !== true) {
    throw new Error(
      `生成尝试 ${attemptId} 不是已计费成功记录，不能 recover-record（当前 ${attempt.status}）。`,
    );
  }
  if (attempt.assetId !== request.assetId || attempt.provider !== provider.id) {
    throw new Error(`生成尝试 ${attemptId} 的资产或 provider 不匹配。`);
  }
  const expectedModel = canonicalAttemptModel({request, provider, model});
  if (attempt.model !== expectedModel) {
    throw new Error(
      `生成尝试 ${attemptId} 的 model ${attempt.model ?? '(none)'} 与当前已确认模型 ${expectedModel ?? '(none)'} 不匹配。`,
    );
  }
  if (attempt.requestFingerprint !== generationRequestFingerprint(request)) {
    throw new Error(`生成尝试 ${attemptId} 的请求已变化，不能恢复登记。`);
  }
  if (output && attempt.output && attempt.output !== output) {
    throw new Error(`生成尝试 ${attemptId} 的输出路径与待登记文件不匹配。`);
  }
  if (outputSha256 && attempt.outputSha256 && attempt.outputSha256 !== outputSha256) {
    throw new Error(`生成尝试 ${attemptId} 的输出哈希与待登记文件不匹配。`);
  }
  return loaded;
};

export const closeGenerationAttempt = async ({
  slug,
  attemptId,
  status,
  quotaConsumed,
  output = null,
  outputSha256 = null,
  note = '',
}) => {
  if (!GENERATION_ATTEMPT_STATUSES.includes(status) || status === 'reserved') {
    throw new Error('关闭状态必须是 succeeded、rejected、abandoned 或 failed-before-generation。');
  }
  if (typeof quotaConsumed !== 'boolean') throw new Error('关闭生成尝试必须明确 quotaConsumed。');
  if (['succeeded', 'rejected'].includes(status) && !quotaConsumed) {
    throw new Error(`${status} 必须计入生成额度。`);
  }
  if (status === 'failed-before-generation' && quotaConsumed) {
    throw new Error('failed-before-generation 不得计入生成额度。');
  }
  const result = await withLedgerLock(slug, async () => {
    const loaded = await readGenerationAttemptEvents(slug);
    const attempt = reduceGenerationAttempts(loaded.events).get(attemptId);
    if (!attempt) throw new Error(`生成尝试不存在：${attemptId}`);
    if (attempt.status !== 'reserved') {
      const sameClosure =
        attempt.status === status &&
        attempt.quotaConsumed === quotaConsumed &&
        (attempt.output ?? null) === output &&
        (attempt.outputSha256 ?? null) === outputSha256;
      if (sameClosure) {
        return {file: loaded.file, event: attempt, reused: true};
      }
      throw new Error(
        `生成尝试 ${attemptId} 已关闭为 ${attempt.status}，且与本次关闭参数不一致。`,
      );
    }
    const event = {
      schemaVersion: 1,
      attemptId,
      event: 'closed',
      status,
      projectSlug: slug,
      assetId: attempt.assetId,
      provider: attempt.provider,
      model: attempt.model,
      requestFingerprint: attempt.requestFingerprint,
      quotaConsumed,
      output,
      outputSha256,
      note: String(note ?? ''),
      at: new Date().toISOString(),
    };
    await appendEvent(loaded.file, event);
    return {file: loaded.file, event, reused: false};
  });
  return result;
};
