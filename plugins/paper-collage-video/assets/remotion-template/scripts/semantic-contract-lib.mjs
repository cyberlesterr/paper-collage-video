import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(scriptDirectory, '..');
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SEMANTIC_RISK_CLASSES = [
  'decorative',
  'identity-critical',
  'topology-critical',
  'mechanism-critical',
  'diagram-critical',
];

export const SEMANTIC_CHECKS_BY_KIND = {
  identity: [
    'identity-distinct-within-frame',
    'identity-family-consistent',
    'cross-scene-identity-continuity',
  ],
  topology: [
    'silhouette-fidelity',
    'negative-space-clean',
    'background-leak-free',
  ],
  mechanism: [
    'mechanism-complete',
    'load-path-readable',
    'physical-plausibility',
    'reference-conformant',
  ],
  diagram: [
    'diagram-edge-clean',
    'small-text-legible',
    'no-procedural-noise-on-semantic-lines',
  ],
};

export const SEMANTIC_CHECKS_BY_RISK = {
  decorative: [],
  'identity-critical': ['identity-family-consistent'],
  'topology-critical': SEMANTIC_CHECKS_BY_KIND.topology,
  'mechanism-critical': SEMANTIC_CHECKS_BY_KIND.mechanism,
  'diagram-critical': SEMANTIC_CHECKS_BY_KIND.diagram,
};

export const SEMANTIC_ASSET_CHECKS_BY_KIND = {
  identity: ['identity-family-consistent'],
  topology: SEMANTIC_CHECKS_BY_KIND.topology,
  mechanism: SEMANTIC_CHECKS_BY_KIND.mechanism,
  diagram: SEMANTIC_CHECKS_BY_KIND.diagram,
};

export const CONTRACT_KIND_BY_RISK = {
  'identity-critical': 'identity',
  'topology-critical': 'topology',
  'mechanism-critical': 'mechanism',
  'diagram-critical': 'diagram',
};

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

export const semanticValueFingerprint = (value) =>
  createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');

export const semanticContractsPath = (slug) =>
  path.join(ROOT, 'projects', slug, 'semantic-contracts.json');

const normalizedFingerprintFields = (fingerprint = {}) =>
  [
    fingerprint.faceOrFront,
    fingerprint.bodyOrProportion,
    fingerprint.headOrTop,
    fingerprint.facialHairOrDetail,
    (fingerprint.palette ?? []).length ? fingerprint.palette.join('|') : null,
    (fingerprint.distinguishingFeatures ?? []).length
      ? fingerprint.distinguishingFeatures.join('|')
      : null,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim().toLowerCase());

const fingerprintDifferenceCount = (left, right) => {
  const fields = [
    'faceOrFront',
    'bodyOrProportion',
    'headOrTop',
    'facialHairOrDetail',
  ];
  let differences = fields.filter(
    (field) =>
      String(left?.[field] ?? '').trim().toLowerCase() !==
      String(right?.[field] ?? '').trim().toLowerCase(),
  ).length;
  const leftPalette = JSON.stringify([...(left?.palette ?? [])].sort());
  const rightPalette = JSON.stringify([...(right?.palette ?? [])].sort());
  if (leftPalette !== rightPalette) differences += 1;
  const leftFeatures = JSON.stringify([...(left?.distinguishingFeatures ?? [])].sort());
  const rightFeatures = JSON.stringify([...(right?.distinguishingFeatures ?? [])].sort());
  if (leftFeatures !== rightFeatures) differences += 1;
  return differences;
};

export const validateSemanticContracts = (document, {projectSlug = null} = {}) => {
  const issues = [];
  const add = (code, message, location) =>
    issues.push({level: 'error', code, message, location});

  if (document?.schemaVersion !== 1) {
    add('schema-version', 'semantic-contracts schemaVersion 必须为 1。', 'schemaVersion');
  }
  if (!ID_PATTERN.test(document?.projectSlug ?? '')) {
    add('project-slug', 'projectSlug 格式无效。', 'projectSlug');
  } else if (projectSlug && document.projectSlug !== projectSlug) {
    add('project-slug-mismatch', `projectSlug 必须为 ${projectSlug}。`, 'projectSlug');
  }
  if (!['draft', 'ready'].includes(document?.status)) {
    add('status', 'status 必须为 draft 或 ready。', 'status');
  }
  if (!Array.isArray(document?.contracts)) {
    add('contracts', 'contracts 必须是数组。', 'contracts');
    return issues;
  }

  const contractIds = new Set();
  for (const [contractIndex, contract] of document.contracts.entries()) {
    const base = `contracts.${contractIndex}`;
    if (!ID_PATTERN.test(contract?.id ?? '')) {
      add('contract-id', '契约 id 格式无效。', `${base}.id`);
    } else if (contractIds.has(contract.id)) {
      add('contract-id-duplicate', `契约 id 重复：${contract.id}。`, `${base}.id`);
    } else {
      contractIds.add(contract.id);
    }
    if (!Object.hasOwn(SEMANTIC_CHECKS_BY_KIND, contract?.kind)) {
      add('contract-kind', 'kind 必须是 identity、topology、mechanism 或 diagram。', `${base}.kind`);
      continue;
    }
    if (typeof contract.title !== 'string' || !contract.title.trim()) {
      add('contract-title', '契约必须提供 title。', `${base}.title`);
    }
    if (!Array.isArray(contract.invariants) || contract.invariants.length === 0) {
      add('contract-invariants', '契约必须声明至少一条 invariant。', `${base}.invariants`);
    }
    if (!Array.isArray(contract.evidenceTargets) || contract.evidenceTargets.length === 0) {
      add('contract-evidence', '契约必须声明至少一个 evidenceTarget。', `${base}.evidenceTargets`);
    }

    const targetIds = new Set();
    for (const [targetIndex, target] of (contract.evidenceTargets ?? []).entries()) {
      const targetBase = `${base}.evidenceTargets.${targetIndex}`;
      if (!ID_PATTERN.test(target?.id ?? '')) {
        add('evidence-id', 'evidenceTarget id 格式无效。', `${targetBase}.id`);
      } else if (targetIds.has(target.id)) {
        add('evidence-id-duplicate', `evidenceTarget id 重复：${target.id}。`, `${targetBase}.id`);
      } else {
        targetIds.add(target.id);
      }
      const allowedChecks = SEMANTIC_CHECKS_BY_KIND[contract.kind];
      if (
        !Array.isArray(target?.checks) ||
        target.checks.length === 0 ||
        target.checks.some((check) => !allowedChecks.includes(check))
      ) {
        add('evidence-checks', `checks 必须来自 ${allowedChecks.join(', ')}。`, `${targetBase}.checks`);
      }
      if (!Array.isArray(target?.shots) || target.shots.length === 0) {
        add('evidence-shots', 'evidenceTarget 至少需要一个 shot。', `${targetBase}.shots`);
      }
      for (const [shotIndex, shot] of (target.shots ?? []).entries()) {
        const shotBase = `${targetBase}.shots.${shotIndex}`;
        if (!shot?.sceneId) add('evidence-scene', 'shot 缺少 sceneId。', `${shotBase}.sceneId`);
        if (!Array.isArray(shot?.proofTimeIds) || shot.proofTimeIds.length === 0) {
          add('evidence-proof-times', 'shot 至少需要一个 proofTimeId。', `${shotBase}.proofTimeIds`);
        }
      }
      if (
        target?.checks?.includes('cross-scene-identity-continuity') &&
        new Set((target.shots ?? []).map(({sceneId}) => sceneId)).size < 2
      ) {
        add(
          'cross-scene-evidence',
          'cross-scene-identity-continuity 必须比较至少两个不同场景。',
          `${targetBase}.shots`,
        );
      }
    }

    if (contract.kind !== 'identity') {
      const coveredChecks = new Set(
        (contract.evidenceTargets ?? []).flatMap(({checks}) => checks ?? []),
      );
      const missingChecks = SEMANTIC_CHECKS_BY_KIND[contract.kind].filter(
        (check) => !coveredChecks.has(check),
      );
      if (missingChecks.length) {
        add(
          'semantic-check-coverage',
          `${contract.kind} 契约的 evidenceTargets 缺少必需检查：${missingChecks.join(', ')}。`,
          `${base}.evidenceTargets`,
        );
      }
    }

    if (contract.kind === 'identity') {
      if (!Array.isArray(contract.members) || contract.members.length === 0) {
        add('identity-members', 'identity 契约至少需要一个 member。', `${base}.members`);
        continue;
      }
      const members = new Map();
      for (const [memberIndex, member] of contract.members.entries()) {
        const memberBase = `${base}.members.${memberIndex}`;
        if (!ID_PATTERN.test(member?.id ?? '')) {
          add('identity-member-id', 'member id 格式无效。', `${memberBase}.id`);
          continue;
        }
        if (members.has(member.id)) {
          add('identity-member-duplicate', `member id 重复：${member.id}。`, `${memberBase}.id`);
          continue;
        }
        members.set(member.id, member);
        if (normalizedFingerprintFields(member.fingerprint).length < 3) {
          add(
            'identity-fingerprint',
            '每个 identity member 至少需要三个可辨认的视觉指纹字段。',
            `${memberBase}.fingerprint`,
          );
        }
      }
      for (const [setIndex, set] of (contract.coexistenceSets ?? []).entries()) {
        const setBase = `${base}.coexistenceSets.${setIndex}`;
        if (!Array.isArray(set?.memberIds) || set.memberIds.length < 2) {
          add('identity-coexistence', 'coexistenceSet 至少需要两个 memberId。', `${setBase}.memberIds`);
          continue;
        }
        const unknown = set.memberIds.filter((id) => !members.has(id));
        if (unknown.length) {
          add('identity-coexistence-member', `未知 memberId：${unknown.join(', ')}。`, `${setBase}.memberIds`);
        }
        for (let leftIndex = 0; leftIndex < set.memberIds.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < set.memberIds.length; rightIndex += 1) {
            const left = members.get(set.memberIds[leftIndex]);
            const right = members.get(set.memberIds[rightIndex]);
            if (left && right && fingerprintDifferenceCount(left.fingerprint, right.fingerprint) < 2) {
              add(
                'identity-not-distinct',
                `${left.id} 与 ${right.id} 的结构化视觉指纹差异不足两项。`,
                `${setBase}.memberIds`,
              );
            }
          }
        }
        const sceneHasDistinctEvidence = (contract.evidenceTargets ?? []).some(
          ({checks, shots}) =>
            checks?.includes('identity-distinct-within-frame') &&
            shots?.some(({sceneId}) => sceneId === set.sceneId),
        );
        if (!sceneHasDistinctEvidence) {
          add(
            'identity-coexistence-evidence',
            `同帧场景 ${set.sceneId} 必须有 identity-distinct-within-frame 证据。`,
            setBase,
          );
        }
      }
      if (
        (contract.evidenceTargets ?? []).some(({checks}) =>
          checks?.includes('identity-distinct-within-frame'),
        ) &&
        (!Array.isArray(contract.coexistenceSets) || contract.coexistenceSets.length === 0)
      ) {
        add(
          'identity-coexistence-required',
          '同帧身份差异检查需要 coexistenceSets。',
          `${base}.coexistenceSets`,
        );
      }
    }

    if (contract.kind === 'mechanism') {
      const parts = new Set((contract.parts ?? []).map(({id}) => id));
      if (!Array.isArray(contract.parts) || contract.parts.length < 2 || parts.size !== contract.parts.length) {
        add('mechanism-parts', 'mechanism parts 至少包含两个不重复部件。', `${base}.parts`);
      }
      if (!Array.isArray(contract.connections) || contract.connections.length === 0) {
        add('mechanism-connections', 'mechanism 必须声明部件连接。', `${base}.connections`);
      }
      const edges = new Set();
      for (const [connectionIndex, connection] of (contract.connections ?? []).entries()) {
        const connectionBase = `${base}.connections.${connectionIndex}`;
        if (!parts.has(connection.from) || !parts.has(connection.to)) {
          add('mechanism-connection-part', 'connection 引用了未知部件。', connectionBase);
        }
        edges.add(`${connection.from}:${connection.to}`);
        edges.add(`${connection.to}:${connection.from}`);
      }
      if (!Array.isArray(contract.loadPaths) || contract.loadPaths.length === 0) {
        add('mechanism-load-path', 'mechanism 必须声明至少一条 loadPath。', `${base}.loadPaths`);
      }
      for (const [pathIndex, loadPath] of (contract.loadPaths ?? []).entries()) {
        const loadBase = `${base}.loadPaths.${pathIndex}.sequence`;
        if (!Array.isArray(loadPath.sequence) || loadPath.sequence.length < 2) {
          add('mechanism-load-path-sequence', 'loadPath sequence 至少包含两个部件。', loadBase);
          continue;
        }
        for (const partId of loadPath.sequence) {
          if (!parts.has(partId)) add('mechanism-load-path-part', `loadPath 引用了未知部件：${partId}。`, loadBase);
        }
        for (let index = 1; index < loadPath.sequence.length; index += 1) {
          if (!edges.has(`${loadPath.sequence[index - 1]}:${loadPath.sequence[index]}`)) {
            add(
              'mechanism-load-path-disconnected',
              `loadPath 在 ${loadPath.sequence[index - 1]} → ${loadPath.sequence[index]} 之间缺少 connection。`,
              loadBase,
            );
          }
        }
      }
      if (!Array.isArray(contract.degreesOfFreedom) || contract.degreesOfFreedom.length === 0) {
        add('mechanism-motion', 'mechanism 必须声明固定件/活动件或自由度。', `${base}.degreesOfFreedom`);
      }
      if (!Array.isArray(contract.forbiddenForms) || contract.forbiddenForms.length === 0) {
        add('mechanism-forbidden', 'mechanism 必须声明至少一种禁止形态。', `${base}.forbiddenForms`);
      }
      if (!Array.isArray(contract.references) || contract.references.length === 0) {
        add('mechanism-reference', 'mechanism 必须提供至少一项结构参考证据。', `${base}.references`);
      }
    }

    if (contract.kind === 'diagram') {
      if (!Array.isArray(contract.protectedLayers) || contract.protectedLayers.length === 0) {
        add('diagram-layers', 'diagram 必须声明受保护的语义图层。', `${base}.protectedLayers`);
      }
      const forbidden = new Set(contract.forbiddenSvgFeatures ?? []);
      for (const feature of ['feTurbulence', 'feDisplacementMap', 'feBlend']) {
        if (!forbidden.has(feature)) {
          add('diagram-filter-policy', `diagram 必须禁止 ${feature}。`, `${base}.forbiddenSvgFeatures`);
        }
      }
      if (
        !Number.isInteger(contract.finalCanvas?.width) ||
        contract.finalCanvas.width < 1 ||
        !Number.isInteger(contract.finalCanvas?.height) ||
        contract.finalCanvas.height < 1
      ) {
        add('diagram-canvas', 'diagram 必须声明有效的 finalCanvas。', `${base}.finalCanvas`);
      }
    }

    if (contract.kind === 'topology') {
      if (!Array.isArray(contract.subjectIds) || contract.subjectIds.length === 0) {
        add('topology-subjects', 'topology 必须声明 subjectIds。', `${base}.subjectIds`);
      }
      if (
        (!Array.isArray(contract.requiredVisibleParts) || contract.requiredVisibleParts.length === 0) &&
        (!Array.isArray(contract.requiredNegativeSpaces) || contract.requiredNegativeSpaces.length === 0)
      ) {
        add(
          'topology-evidence',
          'topology 至少需要 requiredVisibleParts 或 requiredNegativeSpaces。',
          base,
        );
      }
    }
  }
  return issues;
};

export const validateSemanticEvidenceTargets = (document, project) => {
  const issues = [];
  const scenes = new Map((project?.scenes ?? []).map((scene) => [scene.id, scene]));
  const nodeIds = (nodes, result = new Set()) => {
    for (const node of nodes ?? []) {
      result.add(node.id);
      if (node.kind === 'group') nodeIds(node.children, result);
    }
    return result;
  };
  for (const contract of document?.contracts ?? []) {
    for (const target of contract.evidenceTargets ?? []) {
      for (const shot of target.shots ?? []) {
        const location = `${contract.id}/${target.id}/${shot.sceneId}`;
        const scene = scenes.get(shot.sceneId);
        if (!scene) {
          issues.push(`${location}: 未知场景。`);
          continue;
        }
        if (shot.nodeId && !nodeIds(scene.composition?.nodes).has(shot.nodeId)) {
          issues.push(`${location}: 未知节点 ${shot.nodeId}。`);
        }
        const proofIds = new Set((scene.motion?.proofTimes ?? []).map(({id}) => id));
        const missingProofs = shot.proofTimeIds.filter((id) => !proofIds.has(id));
        if (missingProofs.length) {
          issues.push(`${location}: 未知 proofTimeId ${missingProofs.join(', ')}。`);
        }
      }
    }
  }
  return issues;
};

export const loadSemanticContracts = async (slug, {required = false} = {}) => {
  const file = semanticContractsPath(slug);
  let document;
  try {
    document = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (!required && error?.code === 'ENOENT') {
      return {file, document: null, contracts: new Map(), fingerprints: new Map(), issues: []};
    }
    if (error?.code === 'ENOENT') throw new Error(`缺少语义契约：projects/${slug}/semantic-contracts.json`);
    throw error;
  }
  const issues = validateSemanticContracts(document, {projectSlug: slug});
  const contracts = new Map((document.contracts ?? []).map((contract) => [contract.id, contract]));
  const fingerprints = new Map(
    [...contracts].map(([id, contract]) => [id, semanticValueFingerprint(contract)]),
  );
  return {file, document, contracts, fingerprints, issues};
};

export const assertSemanticContractsReady = async (slug) => {
  const loaded = await loadSemanticContracts(slug, {required: true});
  if (loaded.issues.length) {
    throw new Error(
      loaded.issues.map(({location, message}) => `${location}: ${message}`).join('\n'),
    );
  }
  if (loaded.document.status !== 'ready') {
    throw new Error('semantic-contracts.json 尚未锁定为 ready。');
  }
  return loaded;
};

export const requiredChecksForSemanticBinding = (binding, contracts = []) =>
  [...new Set([
    ...(SEMANTIC_CHECKS_BY_RISK[binding?.riskClass] ?? []),
    ...contracts.flatMap(({kind}) => SEMANTIC_ASSET_CHECKS_BY_KIND[kind] ?? []),
  ])];

export const assertRequestSemanticContracts = async (request) => {
  if (request?.capability !== 'image' || request.schemaVersion < 3) return null;
  const binding = request.semanticBinding;
  if (binding.riskClass === 'decorative') {
    if (binding.contractIds.length > 0) {
      throw new Error('decorative 图像不得绑定关键 semantic contract；请改用对应的主风险类别。');
    }
    return null;
  }
  const loaded = await assertSemanticContractsReady(request.projectSlug);
  const missing = binding.contractIds.filter((id) => !loaded.contracts.has(id));
  if (missing.length) throw new Error(`semanticBinding 引用了未知契约：${missing.join(', ')}`);
  const boundContracts = binding.contractIds.map((id) => loaded.contracts.get(id));
  const requiredKind = CONTRACT_KIND_BY_RISK[binding.riskClass];
  const matching = boundContracts.filter(({kind}) => kind === requiredKind);
  if (matching.length === 0) {
    throw new Error(`${binding.riskClass} 至少需要一个 ${requiredKind} 契约。`);
  }
  const identityContracts = boundContracts.filter(({kind}) => kind === 'identity');
  if (identityContracts.length > 0) {
    if (!binding.generationFamily) {
      throw new Error('绑定 identity 契约的图像必须声明独立的 generationFamily。');
    }
    const memberIds = new Set(identityContracts.flatMap(({members}) => members.map(({id}) => id)));
    const unknown = binding.generationFamily.memberIds.filter((id) => !memberIds.has(id));
    if (unknown.length) {
      throw new Error(`generationFamily 引用了 identity 契约中不存在的成员：${unknown.join(', ')}`);
    }
  }
  const diagramContracts = boundContracts.filter(({kind}) => kind === 'diagram');
  if (diagramContracts.length > 0) {
    const canvasMatches = diagramContracts.some(
      ({finalCanvas}) =>
        finalCanvas?.width === request.compositionBinding.canvas.width &&
        finalCanvas?.height === request.compositionBinding.canvas.height,
    );
    if (!canvasMatches) {
      throw new Error('diagram 契约 finalCanvas 与 compositionBinding.canvas 不一致。');
    }
  }
  const requiredChecks = requiredChecksForSemanticBinding(binding, boundContracts);
  if (
    request.quality?.requiredChecks &&
    requiredChecks.some((check) => !request.quality.requiredChecks.includes(check))
  ) {
    throw new Error('quality.requiredChecks 不得省略任一绑定契约要求的语义检查。');
  }
  return loaded;
};

export const writeSemanticContracts = async ({slug, input}) => {
  const document = {
    ...input,
    $schema: '../../schemas/semantic-contracts.schema.json',
    schemaVersion: 1,
    projectSlug: slug,
    status: 'ready',
    updatedAt: new Date().toISOString(),
  };
  const issues = validateSemanticContracts(document, {projectSlug: slug});
  if (issues.length) {
    throw new Error(issues.map(({location, message}) => `${location}: ${message}`).join('\n'));
  }
  const file = semanticContractsPath(slug);
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return {file, document};
};
