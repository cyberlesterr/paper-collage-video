import {stableValue} from './contract-utils.mjs';
import {createHash} from 'node:crypto';

const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');

const SOURCE_PACKAGE_ROLES = {
  'single-background': ['background'],
  'rigid-master': ['master'],
  'registered-layer-sheet': ['registered-sheet'],
  'context-preserving-layer-edits': [
    'reference',
    'support-rear',
    'subject',
    'support-front',
  ],
  'canonical-frame-with-content-sheet': [
    'clean-plate',
    'canonical-frame',
    'content-state-sheet',
  ],
};

const collectProviderStateFamilies = (scenes) => {
  const sourceOwnedFamilyIds = new Set(
    scenes.flatMap((scene) =>
      (scene.sourcePackages ?? [])
        .map(({stateFamilyId}) => stateFamilyId)
        .filter(Boolean),
    ),
  );
  const families = new Map();
  for (const scene of scenes) {
    for (const family of scene.stateFamilies ?? []) {
      if (sourceOwnedFamilyIds.has(family.id)) continue;
      families.set(family.id, family);
    }
  }
  return [...families.values()];
};

export const buildProviderRootPlan = (option) => {
  const roots = [
    {
      id: 'style-proof:style-sample',
      kind: 'style-proof',
      role: 'style-sample',
      sceneId: null,
      sourcePackageId: null,
      sourceStrategy: null,
      poseFamilyId: null,
    },
  ];
  for (const scene of option.scenes ?? []) {
    for (const source of scene.sourcePackages ?? []) {
      const roles = SOURCE_PACKAGE_ROLES[source.strategy];
      if (!roles || roles.length !== source.providerCalls) {
        throw new Error(
          `${option.id}.${source.id} 无法编译 provider 根资产：${source.strategy} ` +
            `声明 ${source.providerCalls} 次调用，但合同角色为 ${roles?.length ?? 0} 个。`,
        );
      }
      for (const role of roles) {
        roots.push({
          id: `source-package:${source.id}:${role}`,
          kind: 'source-package',
          role,
          sceneId: scene.id,
          sourcePackageId: source.id,
          sourceStrategy: source.strategy,
          poseFamilyId: null,
        });
      }
    }
  }
  for (const family of collectProviderStateFamilies(option.scenes ?? [])) {
    roots.push({
      id: `pose-sheet:${family.id}`,
      kind: 'pose-sheet',
      role: 'state-sheet',
      sceneId: null,
      sourcePackageId: null,
      sourceStrategy: null,
      poseFamilyId: family.id,
    });
  }
  const basis = {schemaVersion: 1, roots};
  return {
    ...basis,
    fingerprint: sha256(JSON.stringify(stableValue(basis))),
  };
};

export const validateProviderRootPlan = (plan) => {
  const errors = [];
  if (plan?.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
  if (!Array.isArray(plan?.roots) || plan.roots.length < 1) {
    errors.push('roots 必须为非空数组');
  }
  const ids = new Set();
  for (const [index, root] of (plan?.roots ?? []).entries()) {
    if (!root?.id || ids.has(root.id)) {
      errors.push(`roots[${index}].id 缺失或重复`);
    }
    ids.add(root?.id);
    if (!['style-proof', 'source-package', 'pose-sheet'].includes(root?.kind)) {
      errors.push(`roots[${index}].kind 无效`);
    }
  }
  const rebuilt = {
    schemaVersion: plan?.schemaVersion,
    roots: plan?.roots,
  };
  if (
    !/^[a-f0-9]{64}$/.test(plan?.fingerprint ?? '') ||
    plan.fingerprint !== sha256(JSON.stringify(stableValue(rebuilt)))
  ) {
    errors.push('fingerprint 与根资产清单不一致');
  }
  return errors;
};

export const assertScenarioRootRequest = ({request, scenarioBinding}) => {
  const derivationMethod = request.compositionBinding?.derivation?.method;
  const consumesProviderRoot =
    request.capability === 'image' &&
    ['provider-generation', 'provider-edit'].includes(derivationMethod);
  const binding = request.scenarioRootBinding;
  if (!scenarioBinding) {
    if (binding !== undefined) {
      throw new Error('非 scenario-bound 项目不得声明 scenarioRootBinding');
    }
    return null;
  }
  if (!consumesProviderRoot) {
    if (binding !== undefined) {
      throw new Error(
        '只有 provider-generation/provider-edit 图片请求可以声明 scenarioRootBinding',
      );
    }
    return null;
  }
  const plan = scenarioBinding.providerRootPlan;
  const planErrors = validateProviderRootPlan(plan);
  if (planErrors.length > 0) {
    throw new Error(`项目 provider 根资产计划无效：${planErrors.join('；')}`);
  }
  if (
    binding?.schemaVersion !== 1 ||
    binding.planFingerprint !== plan.fingerprint ||
    typeof binding.rootId !== 'string'
  ) {
    throw new Error(
      'scenario-bound provider 图片请求必须绑定当前 providerRootPlan fingerprint/rootId',
    );
  }
  const root = plan.roots.find(({id}) => id === binding.rootId);
  if (!root) throw new Error(`scenarioRootBinding.rootId 未在批准计划中：${binding.rootId}`);
  if (root.kind === 'style-proof') {
    if (request.quality?.kind !== 'style-sample') {
      throw new Error(`${root.id} 必须是 quality.kind=style-sample 的风格样张`);
    }
  } else if (root.kind === 'pose-sheet') {
    if (request.stateSheetBinding?.poseFamilyId !== root.poseFamilyId) {
      throw new Error(
        `${root.id} 必须由 poseFamilyId=${root.poseFamilyId} 的完整姿态母版实现`,
      );
    }
  } else {
    if (request.compositionBinding?.sceneId !== root.sceneId) {
      throw new Error(`${root.id} 必须绑定 sceneId=${root.sceneId}`);
    }
    const packageBinding =
      request.layerPackageBinding ?? request.containerPackageBinding ?? null;
    if (
      packageBinding &&
      packageBinding.sourcePackageId !== root.sourcePackageId
    ) {
      throw new Error(`${root.id} 的 sourcePackageId 与请求包绑定不一致`);
    }
    if (
      root.sourceStrategy !== 'single-background' &&
      root.sourceStrategy !== 'rigid-master' &&
      packageBinding?.packageRole !== root.role
    ) {
      throw new Error(`${root.id} 必须由 packageRole=${root.role} 的 provider 根实现`);
    }
  }
  return root;
};

const isRealizedProviderRecord = (record) => {
  const method = record.request?.compositionBinding?.derivation?.method;
  if (!['provider-generation', 'provider-edit'].includes(method)) return false;
  if (record.lifecycle?.status === 'active') return true;
  return (
    record.lifecycle?.status === 'recovery-source' &&
    record.recoveredFromRejectedAttempt === true &&
    record.providerObservation?.sourceAttempt?.status === 'rejected' &&
    record.providerObservation?.sourceAttempt?.quotaConsumed === true
  );
};

export const assessProviderRootRealization = ({scenarioBinding, manifest}) => {
  const plan = scenarioBinding?.providerRootPlan;
  const planErrors = validateProviderRootPlan(plan);
  if (planErrors.length > 0) {
    return {
      passed: false,
      expected: plan?.roots?.length ?? 0,
      realized: 0,
      missingRootIds: [],
      duplicateRootIds: [],
      staleBindings: [],
      issues: planErrors.map((message) => `provider 根资产计划无效：${message}`),
    };
  }
  const byRoot = new Map(plan.roots.map(({id}) => [id, []]));
  const staleBindings = [];
  for (const record of manifest?.assets ?? []) {
    if (!isRealizedProviderRecord(record)) continue;
    const binding = record.request?.scenarioRootBinding;
    if (!binding) continue;
    if (binding.planFingerprint !== plan.fingerprint || !byRoot.has(binding.rootId)) {
      staleBindings.push(record.assetId);
      continue;
    }
    try {
      assertScenarioRootRequest({
        request: record.request,
        scenarioBinding,
      });
    } catch {
      staleBindings.push(record.assetId);
      continue;
    }
    byRoot.get(binding.rootId).push(record);
  }
  const missingRootIds = [];
  const duplicateRootIds = [];
  for (const [rootId, records] of byRoot) {
    if (records.length === 0) missingRootIds.push(rootId);
    if (records.length > 1) duplicateRootIds.push(rootId);
  }
  const realized = [...byRoot.values()].filter(
    (records) => records.length === 1,
  ).length;
  const issues = [];
  if (missingRootIds.length > 0) {
    issues.push(
      `缺少 ${missingRootIds.length} 个批准的 provider 根资产：${missingRootIds.join(', ')}`,
    );
  }
  if (duplicateRootIds.length > 0) {
    issues.push(`provider 根资产被重复实现：${duplicateRootIds.join(', ')}`);
  }
  if (staleBindings.length > 0) {
    issues.push(`存在绑定旧计划或未知根的 provider 资产：${staleBindings.join(', ')}`);
  }
  return {
    passed: issues.length === 0,
    expected: plan.roots.length,
    realized,
    missingRootIds,
    duplicateRootIds,
    staleBindings,
    issues,
  };
};
