import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const FAILURE_CIRCUIT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');

const OPERATIONAL_FILES = new Set([
  'failure-circuit.jsonl',
  'production-metrics.json',
  'quality-review-scaffold.json',
  'quality-review-scaffold.pending.json',
]);

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
};

const hashValue = (value) =>
  createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');

const pathExists = async (file) =>
  fs.stat(file).then(() => true).catch(() => false);

const normalizedRelative = (root, file) =>
  path.relative(root, file).split(path.sep).join('/');

const shouldSkipInputFile = ({file, directoryKind}) => {
  const basename = path.basename(file);
  if (OPERATIONAL_FILES.has(basename)) return true;
  if (directoryKind === 'dist') return true;
  return false;
};

const collectDirectorySignature = async ({
  root,
  directory,
  directoryKind,
}) => {
  if (directoryKind === 'dist') return [];
  if (!(await pathExists(directory))) return [];
  const entries = [];
  const walk = async (current) => {
    const children = await fs.readdir(current, {withFileTypes: true});
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const file = path.join(current, child.name);
      if (child.isDirectory()) {
        if (
          directoryKind === 'public' &&
          child.name === 'visual-blueprint-proxies'
        ) {
          continue;
        }
        await walk(file);
        continue;
      }
      if (!child.isFile() || shouldSkipInputFile({file, directoryKind})) {
        continue;
      }
      const stat = await fs.stat(file);
      const relative = normalizedRelative(root, file);
      const extension = path.extname(file).toLowerCase();
      const contentHash = [
        '.json',
        '.jsonl',
        '.md',
        '.mjs',
        '.js',
        '.ts',
        '.tsx',
      ].includes(extension)
        ? createHash('sha256').update(await fs.readFile(file)).digest('hex')
        : null;
      entries.push({
        file: relative,
        size: stat.size,
        modifiedMs: Math.floor(stat.mtimeMs),
        contentHash,
      });
    }
  };
  await walk(directory);
  return entries;
};

export const failureCircuitPath = (slug, root = FAILURE_CIRCUIT_ROOT) =>
  path.join(root, 'projects', slug, 'failure-circuit.jsonl');

export const readFailureCircuitEvents = async (
  slug,
  {root = FAILURE_CIRCUIT_ROOT} = {},
) => {
  const file = failureCircuitPath(slug, root);
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
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error(`failure-circuit.jsonl 第 ${index + 1} 行不是有效 JSON。`);
      }
      if (
        event?.schemaVersion !== 1 ||
        event.projectSlug !== slug ||
        !['failure', 'resolved'].includes(event.event)
      ) {
        throw new Error(`failure-circuit.jsonl 第 ${index + 1} 行格式无效。`);
      }
      return event;
    });
  return {file, exists: true, events};
};

const circuitIdFor = ({operation, failureSignature}) =>
  `circuit-${createHash('sha256')
    .update(`${operation}\0${failureSignature}`)
    .digest('hex')
    .slice(0, 16)}`;

export const normalizeFailureEvidence = (value) =>
  String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        /failed|error|错误|失败|缺少|未通过|拒绝|invalid|missing|cannot|must|需要/i.test(
          line,
        ),
    )
    .slice(-6)
    .join(' | ')
    .replace(/[a-f0-9]{64}/gi, '<hash>')
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '<uuid>',
    )
    .replace(/(?:\/[^\s:]+)+/g, '<path>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();

export const deriveFailureSignature = ({
  operation,
  exitCode = null,
  signal = null,
  stdout = '',
  stderr = '',
  explicit = null,
}) => {
  const evidence =
    normalizeFailureEvidence(explicit ?? `${stderr}\n${stdout}`) ||
    `exit=${exitCode ?? 'none'} signal=${signal ?? 'none'}`;
  return hashValue({operation, evidence});
};

export const summarizeFailureCircuits = (events) => {
  const grouped = new Map();
  const activeFailures = [];
  for (const event of events) {
    if (event.event === 'resolved') {
      grouped.delete(event.circuitId);
      for (let index = activeFailures.length - 1; index >= 0; index -= 1) {
        if (activeFailures[index].circuitId === event.circuitId) {
          activeFailures.splice(index, 1);
        }
      }
      continue;
    }
    activeFailures.push(event);
    const current = grouped.get(event.circuitId) ?? {
      circuitId: event.circuitId,
      operation: event.operation,
      failureSignature: event.failureSignature,
      count: 0,
      open: false,
      firstAt: event.at,
      lastAt: event.at,
      evidence: event.evidence,
      inputFingerprints: [],
      eventIds: [],
    };
    current.count += 1;
    current.open = current.count >= 2;
    current.lastAt = event.at;
    current.evidence = event.evidence;
    current.inputFingerprints.push(event.inputFingerprint);
    current.eventIds.push(event.eventId);
    grouped.set(event.circuitId, current);
  }
  return {
    circuits: [...grouped.values()].sort((left, right) =>
      left.lastAt.localeCompare(right.lastAt),
    ),
    activeFailures,
    open: [...grouped.values()].filter(({open}) => open),
  };
};

const appendFailureEvent = async (file, event) => {
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
};

export const computeOperationInputFingerprint = async ({
  slug,
  operation,
  script,
  arguments: commandArguments = [],
  root = FAILURE_CIRCUIT_ROOT,
}) => {
  const projectDirectory = path.join(root, 'projects', slug);
  const publicDirectory = path.join(root, 'public', 'projects', slug);
  const distDirectory = path.join(root, 'dist', slug);
  const scriptFile = path.resolve(root, script);
  const [projectInputs, publicInputs, distInputs, runtimeBuild, scriptHash] =
    await Promise.all([
      collectDirectorySignature({
        root,
        directory: projectDirectory,
        directoryKind: 'project',
      }),
      collectDirectorySignature({
        root,
        directory: publicDirectory,
        directoryKind: 'public',
      }),
      collectDirectorySignature({
        root,
        directory: distDirectory,
        directoryKind: 'dist',
      }),
      fs
        .readFile(path.join(root, 'runtime-build.json'))
        .then((value) => createHash('sha256').update(value).digest('hex'))
        .catch(() => null),
      fs
        .readFile(scriptFile)
        .then((value) => createHash('sha256').update(value).digest('hex'))
        .catch(() => null),
    ]);
  return hashValue({
    operation,
    script: normalizedRelative(root, scriptFile),
    commandArguments,
    executionContext:
      process.env.PAPER_COLLAGE_EXECUTION_CONTEXT ?? 'default',
    runtimeBuild,
    scriptHash,
    projectInputs,
    publicInputs,
    distInputs,
  });
};

export const assertOperationCircuitClosed = async ({
  slug,
  operation,
  root = FAILURE_CIRCUIT_ROOT,
}) => {
  const loaded = await readFailureCircuitEvents(slug, {root});
  const summary = summarizeFailureCircuits(loaded.events);
  const open = summary.open.find((circuit) => circuit.operation === operation);
  if (open) {
    throw new Error(
      `流程熔断已打开：${open.circuitId}；${operation} 已连续出现 ${open.count} 次同类失败。` +
        `停止重试，先运行 project:failures -- ${slug} summary 并取得人的处理决定。`,
    );
  }
  return {file: loaded.file, summary};
};

export const assertOperationAllowed = async ({
  slug,
  operation,
  inputFingerprint,
  root = FAILURE_CIRCUIT_ROOT,
}) => {
  const loaded = await assertOperationCircuitClosed({
    slug,
    operation,
    root,
  });
  const {summary} = loaded;
  const unchanged = summary.activeFailures.find(
    (failure) =>
      failure.operation === operation &&
      failure.inputFingerprint === inputFingerprint,
  );
  if (unchanged) {
    throw new Error(
      `禁止原样重跑 ${operation}：上次失败后输入指纹仍是 ${inputFingerprint}。` +
        '先改变真正输入或修复根因；--force 不会绕过此规则。',
    );
  }
  return loaded;
};

export const recordOperationFailure = async ({
  slug,
  operation,
  inputFingerprint,
  failureSignature,
  evidence,
  root = FAILURE_CIRCUIT_ROOT,
}) => {
  const loaded = await readFailureCircuitEvents(slug, {root});
  const circuitId = circuitIdFor({operation, failureSignature});
  const event = {
    schemaVersion: 1,
    eventId: `failure-${randomUUID()}`,
    event: 'failure',
    projectSlug: slug,
    circuitId,
    operation,
    inputFingerprint,
    failureSignature,
    evidence: String(evidence ?? '').slice(-4000),
    at: new Date().toISOString(),
  };
  await appendFailureEvent(loaded.file, event);
  const summary = summarizeFailureCircuits([...loaded.events, event]);
  return {
    file: loaded.file,
    event,
    circuit: summary.circuits.find(
      (candidate) => candidate.circuitId === circuitId,
    ),
  };
};

export const recordOperationSuccess = async ({
  slug,
  operation,
  inputFingerprint,
  note = null,
  root = FAILURE_CIRCUIT_ROOT,
}) => {
  const loaded = await readFailureCircuitEvents(slug, {root});
  const summary = summarizeFailureCircuits(loaded.events);
  const open = summary.open.find(
    (circuit) => circuit.operation === operation,
  );
  if (open) {
    throw new Error(
      `流程熔断 ${open.circuitId} 已打开；成功结果也不能自动覆盖人的停机决定。` +
        `请先运行 project:failures -- ${slug} resolve ${open.circuitId} --note=<人的决定>。`,
    );
  }
  const circuits = summary.circuits.filter(
    (circuit) => circuit.operation === operation,
  );
  const events = [];
  for (const circuit of circuits) {
    const event = {
      schemaVersion: 1,
      eventId: `resolution-${randomUUID()}`,
      event: 'resolved',
      projectSlug: slug,
      circuitId: circuit.circuitId,
      operation,
      note:
        String(note ?? '').trim() ||
        `automatic recovery: input ${inputFingerprint} succeeded`,
      at: new Date().toISOString(),
    };
    await appendFailureEvent(loaded.file, event);
    events.push(event);
  }
  return {file: loaded.file, events};
};

export const resolveFailureCircuit = async ({
  slug,
  circuitId,
  note,
  root = FAILURE_CIRCUIT_ROOT,
}) => {
  const decision = String(note ?? '').trim();
  if (!decision) {
    throw new Error('解除熔断必须记录人的明确处理决定。');
  }
  const loaded = await readFailureCircuitEvents(slug, {root});
  const summary = summarizeFailureCircuits(loaded.events);
  const circuit = summary.open.find(
    (candidate) => candidate.circuitId === circuitId,
  );
  if (!circuit) throw new Error(`不存在打开的熔断：${circuitId}`);
  const event = {
    schemaVersion: 1,
    eventId: `resolution-${randomUUID()}`,
    event: 'resolved',
    projectSlug: slug,
    circuitId,
    operation: circuit.operation,
    note: decision,
    at: new Date().toISOString(),
  };
  await appendFailureEvent(loaded.file, event);
  return {file: loaded.file, event};
};
