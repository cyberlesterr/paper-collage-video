import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(scriptDirectory, '..');

export const GENERATION_ATTEMPT_STATUSES = [
  'reserved',
  'succeeded',
  'rejected',
  'abandoned',
  'failed-before-generation',
];

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
};

export const generationRequestFingerprint = (request) =>
  createHash('sha256')
    .update(JSON.stringify(stableValue({
      schemaVersion: request.schemaVersion,
      projectSlug: request.projectSlug,
      assetId: request.assetId,
      capability: request.capability,
      prompt: request.prompt ?? null,
      model: request.model ?? null,
      settings: request.settings ?? {},
      compositionBinding: request.compositionBinding ?? null,
      semanticBinding: request.semanticBinding ?? null,
    })))
    .digest('hex');

export const isQuotaConsumingImageRequest = (request) =>
  request?.capability === 'image' &&
  ['provider-generation', 'provider-edit'].includes(
    request.compositionBinding?.derivation?.method,
  );

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
  const maximum = project.plan?.assetBudget?.maxGeneratedImages;
  if (!Number.isInteger(maximum) || maximum < 1) {
    throw new Error('生成图预算尚未通过概念审批，不能发起生图。');
  }
  return withLedgerLock(request.projectSlug, async () => {
    const loaded = await readGenerationAttemptEvents(request.projectSlug);
    const summary = summarizeGenerationAttempts(loaded.events);
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
      model: model ?? request.model ?? provider.model ?? null,
      requestFingerprint: generationRequestFingerprint(request),
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

export const assertReservedGenerationAttempt = async ({request, provider, attemptId}) => {
  if (!attemptId) throw new Error('schema-v3 生图必须提供预留的 --attempt-id。');
  const loaded = await readGenerationAttemptEvents(request.projectSlug);
  const attempt = reduceGenerationAttempts(loaded.events).get(attemptId);
  if (!attempt) throw new Error(`生成尝试不存在：${attemptId}`);
  if (attempt.status !== 'reserved') throw new Error(`生成尝试 ${attemptId} 已关闭为 ${attempt.status}。`);
  if (attempt.assetId !== request.assetId) throw new Error(`生成尝试 ${attemptId} 不属于资产 ${request.assetId}。`);
  if (attempt.provider !== provider.id) throw new Error(`生成尝试 ${attemptId} 的 provider 不匹配。`);
  if (attempt.requestFingerprint !== generationRequestFingerprint(request)) {
    throw new Error(`生成尝试 ${attemptId} 的请求已变化，请重新预留。`);
  }
  return {file: loaded.file, attempt};
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
  return withLedgerLock(slug, async () => {
    const loaded = await readGenerationAttemptEvents(slug);
    const attempt = reduceGenerationAttempts(loaded.events).get(attemptId);
    if (!attempt) throw new Error(`生成尝试不存在：${attemptId}`);
    if (attempt.status !== 'reserved') throw new Error(`生成尝试 ${attemptId} 已关闭为 ${attempt.status}。`);
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
    return {file: loaded.file, event};
  });
};
