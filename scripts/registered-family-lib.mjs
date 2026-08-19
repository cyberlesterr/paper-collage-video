import {stableValue} from './contract-utils.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  assertAssetManifest,
  createAssetRecordId,
} from './asset-manifest-lib.mjs';
import {removeChromaKey} from './chroma-key-lib.mjs';

export const REGISTERED_FAMILY_ROLES = [
  'support-rear',
  'subject',
  'support-front',
];

export const REGISTERED_FAMILY_RECOVERY_POLICY = {
  strategy: 'preserve-family-context',
  localDeterministicFixFirst: true,
  isolatedMemberGeneration: 'forbidden',
  providerRepair: 'masked-complete-source-edit',
  fallback: 'full-source-regeneration',
};
export const REGISTERED_FAMILY_COMPLETENESS = {
  'support-rear': 'clean-plate',
  subject: 'full-silhouette',
  'support-front': 'full-overlay',
};
const REGISTERED_FAMILY_PATTERNS = [
  'supported-subject',
  'registered-depth-stack',
];
const REGISTERED_FAMILY_SOURCE_STRATEGIES = [
  'registered-layer-sheet',
  'context-preserving-layer-edits',
];
const RESPONSIVE_LAYER_PROFILES = ['16:9', '9:16', '1:1'];

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const nonEmpty = (value) =>
  typeof value === 'string' && value.trim().length > 0;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const sha256Value = (value) =>
  createHash('sha256').update(value).digest('hex');

export const sha256File = async (file) =>
  sha256Value(await fs.readFile(file));

const validRect = (rect) =>
  isObject(rect) &&
  Number.isInteger(rect.left) &&
  rect.left >= 0 &&
  Number.isInteger(rect.top) &&
  rect.top >= 0 &&
  Number.isInteger(rect.width) &&
  rect.width > 0 &&
  Number.isInteger(rect.height) &&
  rect.height > 0;

const rectWithin = (rect, canvas) =>
  validRect(rect) &&
  rect.left + rect.width <= canvas.width &&
  rect.top + rect.height <= canvas.height;

const sameValue = (left, right) =>
  JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));

export const validateRegisteredFamilySpec = (spec) => {
  const errors = [];
  if (spec?.schemaVersion !== 2) errors.push('schemaVersion 必须为 2');
  for (const field of [
    'projectSlug',
    'sceneId',
    'groupId',
    'familyId',
    'sourcePackageId',
  ]) {
    if (!nonEmpty(spec?.[field])) errors.push(`${field} 不能为空`);
  }
  if (!slugPattern.test(spec?.projectSlug ?? '')) {
    errors.push('projectSlug 格式无效');
  }
  if (!slugPattern.test(spec?.familyId ?? '')) {
    errors.push('familyId 格式无效');
  }
  if (!slugPattern.test(spec?.sourcePackageId ?? '')) {
    errors.push('sourcePackageId 格式无效');
  }
  if (!REGISTERED_FAMILY_PATTERNS.includes(spec?.pattern)) {
    errors.push('pattern 必须是 supported-subject 或 registered-depth-stack');
  }
  if (spec?.motionCapability !== 'bounded-relative') {
    errors.push('motionCapability 必须是 bounded-relative');
  }
  if (!REGISTERED_FAMILY_SOURCE_STRATEGIES.includes(spec?.sourceStrategy)) {
    errors.push(
      'sourceStrategy 必须是 registered-layer-sheet 或 context-preserving-layer-edits',
    );
  }
  for (const profile of RESPONSIVE_LAYER_PROFILES) {
    const limit = spec?.revealEnvelope?.[profile];
    if (
      !isObject(limit) ||
      !['x', 'y', 'scale', 'rotationDegrees'].every(
        (key) => Number.isFinite(limit[key]) && limit[key] >= 0,
      )
    ) {
      errors.push(`revealEnvelope.${profile} 必须声明非负 x/y/scale/rotationDegrees`);
    }
  }
  const registration = spec?.registration;
  if (
    !nonEmpty(registration?.id) ||
    !nonEmpty(registration?.sourceMasterAssetId) ||
    registration?.origin !== 'top-left' ||
    !Number.isInteger(registration?.canvas?.width) ||
    registration.canvas.width < 1 ||
    !Number.isInteger(registration?.canvas?.height) ||
    registration.canvas.height < 1
  ) {
    errors.push('registration 必须声明 id、sourceMasterAssetId、正整数 canvas 和 top-left origin');
  }
  if (
    !Array.isArray(spec?.members) ||
    spec.members.length !== REGISTERED_FAMILY_ROLES.length
  ) {
    errors.push('members 必须恰好包含三种注册层角色');
  }
  const roles = new Set();
  const slots = new Set();
  const assetIds = new Set();
  const nodeIds = new Set();
  const outputs = new Set();
  for (const [index, member] of (spec?.members ?? []).entries()) {
    const location = `members[${index}]`;
    if (!nonEmpty(member?.assetId) || assetIds.has(member.assetId)) {
      errors.push(`${location}.assetId 缺失或重复`);
    }
    if (!nonEmpty(member?.nodeId) || nodeIds.has(member.nodeId)) {
      errors.push(`${location}.nodeId 缺失或重复`);
    }
    if (!REGISTERED_FAMILY_ROLES.includes(member?.role) || roles.has(member.role)) {
      errors.push(`${location}.role 缺失、重复或无效`);
    }
    if (member?.slot !== member?.role || slots.has(member.slot)) {
      errors.push(`${location}.slot 必须与唯一 role 相同`);
    }
    if (
      member?.completeness !==
      REGISTERED_FAMILY_COMPLETENESS[member?.role]
    ) {
      errors.push(
        `${location}.completeness 必须是 ${REGISTERED_FAMILY_COMPLETENESS[member?.role] ?? '对应角色完整性'}`,
      );
    }
    if (!nonEmpty(member?.output) || outputs.has(member.output)) {
      errors.push(`${location}.output 缺失或重复`);
    }
    if (
      !['registered-layer-sheet', 'layer-package-member', 'state-sheet-cell']
        .includes(member?.source?.kind) ||
      !nonEmpty(member?.source?.assetId)
    ) {
      errors.push(`${location}.source 无效`);
    }
    if (
      member?.source?.kind === 'registered-layer-sheet' &&
      member.source.packageRole !== member.role &&
      !(
        member.source.packageRole === 'support-front' &&
        member.source.reuseAsRole === 'support-rear' &&
        member.role === 'support-rear' &&
        member.derivation?.keying !== undefined &&
        member.derivation?.clip === undefined
      )
    ) {
      errors.push(
        `${location} 的 registered-layer-sheet packageRole 必须与 role 相同；` +
        '只有完整透明 support-front 单元可显式 reuseAsRole=support-rear，且后层不得裁掉主体。',
      );
    }
    if (
      member?.source?.kind === 'state-sheet-cell' &&
      (
        member.role !== 'subject' ||
        !nonEmpty(member.source.poseFamilyId) ||
        !nonEmpty(member.source.stateId)
      )
    ) {
      errors.push(`${location} 的 state-sheet-cell 只能作为 subject，并且必须声明 poseFamilyId/stateId`);
    }
    const derivation = member?.derivation;
    if (!isObject(derivation)) errors.push(`${location}.derivation 必须是对象`);
    if (
      member?.source?.kind === 'state-sheet-cell' &&
      derivation?.placement === undefined
    ) {
      errors.push(`${location} 的 state-sheet-cell 必须显式声明完整注册画布 placement`);
    }
    if (
      derivation?.placement !== undefined &&
      !rectWithin(derivation.placement, registration?.canvas ?? {})
    ) {
      errors.push(`${location}.derivation.placement 必须位于完整注册画布内`);
    }
    if (
      derivation?.sourceRect !== undefined &&
      !validRect(derivation.sourceRect)
    ) {
      errors.push(`${location}.derivation.sourceRect 必须是正整数像素矩形`);
    }
    if (
      derivation?.sourceRect !== undefined &&
      member?.source?.kind !== 'registered-layer-sheet'
    ) {
      errors.push(`${location}.derivation.sourceRect 只能用于 registered-layer-sheet`);
    }
    if (derivation?.keying !== undefined) {
      const keying = derivation.keying;
      if (
        !['registered-layer-sheet', 'layer-package-member']
          .includes(member?.source?.kind) ||
        typeof keying !== 'object' ||
        !/^#[0-9a-fA-F]{6}$/.test(keying.keyColor ?? '') ||
        !Number.isFinite(keying.transparentThreshold) ||
        keying.transparentThreshold < 0 ||
        keying.transparentThreshold > 255 ||
        !Number.isFinite(keying.opaqueThreshold) ||
        keying.opaqueThreshold <= keying.transparentThreshold ||
        keying.opaqueThreshold > 441.7 ||
        !Number.isFinite(keying.edgeFeather) ||
        keying.edgeFeather < 0 ||
        keying.edgeFeather > 8 ||
        !Number.isInteger(keying.matteErode) ||
        keying.matteErode < 0 ||
        keying.matteErode > 8 ||
        !Number.isInteger(keying.edgePadding) ||
        keying.edgePadding < 0 ||
        keying.edgePadding > 32
      ) {
        errors.push(`${location}.derivation.keying 必须是分层母版或完整上下文分层成员的完整色键参数`);
      }
    }
    if (derivation?.maskAssetId !== undefined) {
      if (
        !nonEmpty(derivation.maskAssetId) ||
        !['alpha', 'luminance'].includes(derivation.maskChannel) ||
        typeof derivation.invertMask !== 'boolean'
      ) {
        errors.push(`${location}.derivation mask 必须声明 assetId、channel 和 invertMask`);
      }
    } else if (
      derivation?.maskChannel !== undefined ||
      derivation?.invertMask !== undefined
    ) {
      errors.push(`${location}.derivation 未声明 maskAssetId 时不得声明 mask 参数`);
    }
    if (derivation?.clip?.kind === 'rectangle') {
      if (!rectWithin(derivation.clip.rect, registration?.canvas ?? {})) {
        errors.push(`${location}.derivation.clip.rect 必须位于完整注册画布内`);
      }
    } else if (derivation?.clip?.kind === 'polygon') {
      if (
        !Array.isArray(derivation.clip.points) ||
        derivation.clip.points.length < 3 ||
        derivation.clip.points.some(
          (point) =>
            !Array.isArray(point) ||
            point.length !== 2 ||
            point.some((coordinate) =>
              !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1),
        )
      ) {
        errors.push(`${location}.derivation.clip.points 必须是至少三个归一化点`);
      }
    } else if (derivation?.clip !== undefined) {
      errors.push(`${location}.derivation.clip.kind 无效`);
    }
    assetIds.add(member?.assetId);
    nodeIds.add(member?.nodeId);
    roles.add(member?.role);
    slots.add(member?.slot);
    outputs.add(member?.output);
  }
  for (const role of REGISTERED_FAMILY_ROLES) {
    if (!roles.has(role)) errors.push(`members 缺少 ${role}`);
  }
  if (!sameValue(spec?.recoveryPolicy, REGISTERED_FAMILY_RECOVERY_POLICY)) {
    errors.push('recoveryPolicy 必须是 preserve-family-context 正式策略');
  }
  if (typeof spec?.applyToProject !== 'boolean') {
    errors.push('applyToProject 必须是 boolean');
  }
  return errors;
};

const manifestRecord = (manifest, assetId, allowedStatuses = ['active']) =>
  [...(manifest.assets ?? [])].reverse().find(
    (record) =>
      record.assetId === assetId &&
      allowedStatuses.includes(record.lifecycle?.status),
  ) ?? null;

const activeRecord = (manifest, assetId) =>
  manifestRecord(manifest, assetId);

const assertImageRecord = (
  manifest,
  assetId,
  label,
  {allowRecoverySource = false} = {},
) => {
  const allowedStatuses = allowRecoverySource
    ? ['active', 'recovery-source']
    : ['active'];
  const record = manifestRecord(manifest, assetId, allowedStatuses);
  if (!record || record.capability !== 'image') {
    throw new Error(
      `${label} 必须指向 ${allowedStatuses.join('/')} image manifest 记录：${assetId}`,
    );
  }
  return record;
};

const layerPackageSourceRecord = ({
  manifest,
  assetId,
  registration,
  sourcePackage,
}) =>
  [...(manifest.assets ?? [])].reverse().find((record) => {
    if (
      record.assetId !== assetId ||
      record.capability !== 'image' ||
      !['active', 'recovery-source', 'superseded'].includes(
        record.lifecycle?.status,
      ) ||
      record.adapter === 'registered-family-member'
    ) {
      return false;
    }
    const binding =
      record.compositionBinding?.layerPackageBinding ??
      record.request?.layerPackageBinding;
    return (
      binding?.registrationId === registration.id &&
      binding?.sourceMasterAssetId === registration.sourceMasterAssetId &&
      binding?.sourcePackageId === sourcePackage.id &&
      binding?.sourceStrategy === sourcePackage.strategy &&
      binding?.packageRole === sourcePackage.role &&
      binding?.completeness === sourcePackage.completeness &&
      binding?.canvas?.width === registration.canvas.width &&
      binding?.canvas?.height === registration.canvas.height
    );
  }) ?? null;

const workspacePath = (root, input, label) => {
  const resolved = path.resolve(root, input);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label}越过工作区：${input}`);
  }
  return resolved;
};

const imageMetadata = async (file) => {
  const metadata = await sharp(file).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`无法读取图像尺寸：${file}`);
  }
  return metadata;
};

const chromaKeyCell = async ({input, keying}) => {
  const result = await removeChromaKey({input, ...keying});
  if (
    result.metadata.transparentPixels <= 0 ||
    result.metadata.transparentPixels >= result.metadata.totalPixels
  ) {
    throw new Error(
      `色键派生必须同时保留可见像素和真实透明像素：` +
      `${result.metadata.transparentPixels}/${result.metadata.totalPixels}`,
    );
  }
  return result;
};

const layerSheetCell = async ({
  file,
  record,
  packageRole,
  registration,
  sourcePackage,
  derivation,
}) => {
  const binding =
    record.compositionBinding?.layerPackageBinding ??
    record.request?.layerPackageBinding;
  if (
    binding?.sourcePackageId !== sourcePackage.id ||
    binding?.sourceStrategy !== 'registered-layer-sheet' ||
    binding?.packageRole !== 'registered-sheet' ||
    binding?.registrationId !== registration.id ||
    binding?.sourceMasterAssetId !== registration.sourceMasterAssetId
  ) {
    throw new Error(
      `registered-layer-sheet ${record.assetId} 缺少同一 source package 的正式绑定`,
    );
  }
  const cell = binding.sheetLayout?.cells?.find(
    (candidate) => candidate.packageRole === packageRole,
  );
  if (
    binding.sheetLayout?.columns !== 2 ||
    binding.sheetLayout?.rows !== 2 ||
    binding.sheetLayout?.cells?.length !== 4
  ) {
    throw new Error(
      `registered-layer-sheet ${record.assetId} 必须是 reference + 三层的完整 2x2 sheet`,
    );
  }
  if (!cell) {
    throw new Error(
      `registered-layer-sheet ${record.assetId} 不包含 ${packageRole}`,
    );
  }
  const metadata = await imageMetadata(file);
  const {columns, rows} = binding.sheetLayout;
  const sourceRect = derivation?.sourceRect ?? null;
  if (
    binding.sheetLayout?.providerSource?.cellExtraction === 'explicit-rects' &&
    !sourceRect
  ) {
    throw new Error(
      `registered-sheet ${record.assetId} 使用 provider-native 画布时必须为 ${packageRole} 声明 sourceRect`,
    );
  }
  if (
    !sourceRect &&
    (
      metadata.width % columns !== 0 ||
      metadata.height % rows !== 0
    )
  ) {
    throw new Error(`registered-sheet ${record.assetId} 无法等格分割`);
  }
  const rect = sourceRect ?? {
    left: cell.column * (metadata.width / columns),
    top: cell.row * (metadata.height / rows),
    width: metadata.width / columns,
    height: metadata.height / rows,
  };
  if (
    !validRect(rect) ||
    rect.left + rect.width > metadata.width ||
    rect.top + rect.height > metadata.height
  ) {
    throw new Error(
      `registered-sheet ${record.assetId} 的 ${packageRole} sourceRect 越过 provider 原图`,
    );
  }
  const extracted = await sharp(file)
    .extract(rect)
    .png()
    .toBuffer();
  const surface = cell.outputSurface ?? null;
  const providerObservation = record.providerObservation?.cells?.find(
    (candidate) => candidate.packageRole === packageRole,
  ) ?? null;
  let buffer = extracted;
  let keyingMetadata = null;
  if (surface?.mode === 'chroma-key') {
    if (!derivation?.keying) {
      throw new Error(
        `registered-sheet ${record.assetId} 的 ${packageRole} 色键格缺少正式 keying 参数`,
      );
    }
    if (
      record.lifecycle?.status === 'recovery-source' &&
      (
        record.providerObservation?.mode !== 'provider-native-observed' ||
        !providerObservation?.passed ||
        !providerObservation?.observedKeyColor
      )
    ) {
      throw new Error(
        `recovery-source ${record.assetId} 的 ${packageRole} 缺少通过的 observed key plane provenance`,
      );
    }
    const effectiveKeyColor =
      providerObservation?.observedKeyColor ?? surface.keyColor;
    if (
      derivation.keying.keyColor.toLowerCase() !==
      effectiveKeyColor.toLowerCase()
    ) {
      throw new Error(
        `registered-sheet ${record.assetId} 的 ${packageRole} keying 颜色必须匹配 ` +
        `${providerObservation ? 'provider observed key plane' : 'provider request'}`,
      );
    }
    ({buffer, metadata: keyingMetadata} = await chromaKeyCell({
      input: extracted,
      keying: derivation.keying,
    }));
    if (providerObservation) {
      keyingMetadata = {
        ...keyingMetadata,
        providerObservation: {
          requestedKeyColor: providerObservation.requestedKeyColor,
          observedKeyColor: providerObservation.observedKeyColor,
          policyFingerprint: providerObservation.policyFingerprint,
          observationFingerprint:
            record.providerObservation.observationFingerprint,
          metrics: providerObservation.metrics,
        },
      };
    }
  } else if (derivation?.keying) {
    throw new Error(
      `registered-sheet ${record.assetId} 的 ${packageRole} 非色键格不得声明 keying`,
    );
  } else {
    buffer = await sharp(extracted).ensureAlpha().png().toBuffer();
  }
  if (
    ['subject', 'support-front'].includes(packageRole) &&
    surface?.mode === 'alpha'
  ) {
    const alpha = await sharp(buffer)
      .ensureAlpha()
      .extractChannel(3)
      .raw()
      .toBuffer();
    if (!alpha.some((value) => value < 250)) {
      throw new Error(
        `registered-sheet ${record.assetId} 的 ${packageRole} alpha 格没有真实透明像素`,
      );
    }
  }
  return {
    buffer,
    width: rect.width,
    height: rect.height,
    sourceRect: rect,
    sourceSurface: surface
      ? {
          mode: surface.mode,
          keyColor:
            providerObservation?.observedKeyColor ??
            surface.keyColor ??
            null,
          tolerance: surface.tolerance ?? null,
          requestedKeyColor: surface.keyColor ?? null,
          observedKeyColor:
            providerObservation?.observedKeyColor ?? null,
          observationPolicyId:
            record.providerObservation?.policyId ?? null,
          observationPolicyFingerprint:
            providerObservation?.policyFingerprint ?? null,
          observationFingerprint:
            record.providerObservation?.observationFingerprint ?? null,
        }
      : null,
    keying: derivation?.keying ?? null,
    keyingMetadata,
    lineage: {
      kind: 'registered-layer-sheet',
      assetId: record.assetId,
      stateId: packageRole,
      sourceSheetAssetId: record.assetId,
      sourceFamilyFingerprint: record.familyFingerprint ?? null,
    },
  };
};

const sourceImage = async ({
  root,
  manifest,
  source,
  derivation,
  registration,
  sourcePackage,
}) => {
  const record = source.kind === 'layer-package-member'
    ? layerPackageSourceRecord({
        manifest,
        assetId: source.assetId,
        registration,
        sourcePackage,
      })
    : assertImageRecord(
        manifest,
        source.assetId,
        source.kind,
        {
          allowRecoverySource: source.kind === 'registered-layer-sheet',
        },
      );
  if (!record) {
    throw new Error(
      `${source.kind} 必须指向保留的 provider layer-package image 记录：${source.assetId}`,
    );
  }
  const file = workspacePath(root, record.file, `${source.kind} source`);
  const actualSha256 = await sha256File(file);
  if (record.sha256 !== actualSha256) {
    throw new Error(`${source.kind} ${source.assetId} 的 manifest hash 已漂移`);
  }
  if (source.kind === 'registered-layer-sheet') {
    return {
      record,
      ...await layerSheetCell({
        file,
        record,
        packageRole: source.packageRole,
        registration,
        sourcePackage,
        derivation,
      }),
      sha256: actualSha256,
    };
  }
  const metadata = await imageMetadata(file);
  if (source.kind === 'state-sheet-cell') {
    if (
      record.adapter !== 'registered-sheet-cell' ||
      record.lifecycle?.status !== 'active' ||
      record.compositionBinding?.pattern !== 'state-sequence' ||
      record.compositionBinding?.outputRole !== 'registered-state' ||
      record.stateBinding?.poseFamilyId !== source.poseFamilyId ||
      record.stateBinding?.stateId !== source.stateId ||
      record.media?.hasAlpha !== true
    ) {
      throw new Error(
        `state-sheet-cell ${record.assetId} 必须是匹配 poseFamilyId/stateId 的 active real-alpha 注册状态`,
      );
    }
    return {
      record,
      buffer: await sharp(file).ensureAlpha().png().toBuffer(),
      width: metadata.width,
      height: metadata.height,
      sha256: actualSha256,
      sourceSurface: {
        mode: 'alpha',
        keyColor: null,
        tolerance: null,
        requestedKeyColor: null,
        observedKeyColor: null,
        observationPolicyId: null,
        observationPolicyFingerprint: null,
        observationFingerprint: null,
      },
      keying: null,
      keyingMetadata: null,
      lineage: {
        kind: 'state-sheet-cell',
        assetId: record.assetId,
        stateId: record.stateBinding.stateId,
        sourceSheetAssetId:
          record.sourceSheetAssetId ??
          record.stateBinding.sourceMasterAssetId,
        sourceFamilyFingerprint: record.familyFingerprint ?? null,
      },
    };
  }
  if (source.kind === 'layer-package-member') {
    const binding =
      record.compositionBinding?.layerPackageBinding ??
      record.request?.layerPackageBinding;
    if (
      !binding ||
      binding.registrationId !== registration.id ||
      binding.sourceMasterAssetId !== registration.sourceMasterAssetId ||
      binding.sourcePackageId !== sourcePackage.id ||
      binding.sourceStrategy !== sourcePackage.strategy ||
      binding.packageRole !== sourcePackage.role ||
      binding.completeness !== sourcePackage.completeness ||
      binding.canvas?.width !== registration.canvas.width ||
      binding.canvas?.height !== registration.canvas.height
    ) {
      throw new Error(
        `layer-package-member ${record.assetId} 必须绑定同一 registration/source master 与完整画布`,
      );
    }
    const widthDelta = registration.canvas.width - metadata.width;
    const heightDelta = registration.canvas.height - metadata.height;
    const exactCanvas = widthDelta === 0 && heightDelta === 0;
    const recoverableProviderEdgeDrift =
      record.lifecycle?.status === 'recovery-source' &&
      [widthDelta, heightDelta].every((delta) => delta >= 0 && delta <= 1);
    if (!exactCanvas && !recoverableProviderEdgeDrift) {
      throw new Error(
        `layer-package-member ${record.assetId} 必须保留完整注册画布；` +
        `仅 recovery-source 允许每轴至多短 1 像素并由显式 placement 补齐透明边界`,
      );
    }
    const surface = record.request?.outputSurface ?? null;
    const providerObservation = record.providerObservation?.cells?.find(
      (candidate) => candidate.packageRole === 'image',
    ) ?? null;
    let buffer;
    let keyingMetadata = null;
    if (surface?.mode === 'chroma-key') {
      if (!derivation?.keying) {
        throw new Error(
          `layer-package-member ${record.assetId} 的 chroma-key 来源缺少正式 keying 参数`,
        );
      }
      if (
        record.lifecycle?.status === 'recovery-source' &&
        (
          record.providerObservation?.mode !== 'provider-native-observed' ||
          !providerObservation?.passed ||
          !providerObservation?.observedKeyColor
        )
      ) {
        throw new Error(
          `recovery-source ${record.assetId} 缺少通过的完整画布 observed key plane provenance`,
        );
      }
      const effectiveKeyColor =
        providerObservation?.observedKeyColor ?? surface.keyColor;
      if (
        derivation.keying.keyColor.toLowerCase() !==
        effectiveKeyColor.toLowerCase()
      ) {
        throw new Error(
          `layer-package-member ${record.assetId} 的 keying 颜色必须匹配 ` +
          `${providerObservation ? 'provider observed key plane' : 'provider request'}`,
        );
      }
      ({buffer, metadata: keyingMetadata} = await chromaKeyCell({
        input: file,
        keying: derivation.keying,
      }));
      if (providerObservation) {
        keyingMetadata = {
          ...keyingMetadata,
          providerObservation: {
            requestedKeyColor: providerObservation.requestedKeyColor,
            observedKeyColor: providerObservation.observedKeyColor,
            policyFingerprint: providerObservation.policyFingerprint,
            observationFingerprint:
              record.providerObservation.observationFingerprint,
            metrics: providerObservation.metrics,
          },
        };
      }
    } else if (derivation?.keying) {
      throw new Error(
        `layer-package-member ${record.assetId} 的非色键来源不得声明 keying`,
      );
    } else {
      buffer = await sharp(file).ensureAlpha().png().toBuffer();
    }
    return {
      record,
      buffer,
      width: metadata.width,
      height: metadata.height,
      sha256: actualSha256,
      sourceSurface: surface
        ? {
            mode: surface.mode,
            keyColor:
              providerObservation?.observedKeyColor ??
              surface.keyColor ??
              null,
            tolerance: surface.tolerance ?? null,
            requestedKeyColor: surface.keyColor ?? null,
            observedKeyColor:
              providerObservation?.observedKeyColor ?? null,
            observationPolicyId:
              record.providerObservation?.policyId ?? null,
            observationPolicyFingerprint:
              providerObservation?.policyFingerprint ?? null,
            observationFingerprint:
              record.providerObservation?.observationFingerprint ?? null,
          }
        : null,
      keying: derivation?.keying ?? null,
      keyingMetadata,
      lineage: {
        kind: 'layer-package-member',
        assetId: record.assetId,
        stateId: null,
        sourceSheetAssetId: null,
        sourceFamilyFingerprint: record.familyFingerprint ?? null,
      },
    };
  }
  throw new Error(`未知 registered family source kind: ${source.kind}`);
};

const rgbaMask = async ({file, channel, invert, canvas}) => {
  const metadata = await imageMetadata(file);
  if (
    metadata.width !== canvas.width ||
    metadata.height !== canvas.height
  ) {
    throw new Error(`mask 必须与注册画布 ${canvas.width}x${canvas.height} 完全一致`);
  }
  let alphaImage = channel === 'alpha'
    ? sharp(file).ensureAlpha().extractChannel(3)
    : sharp(file).greyscale();
  if (invert) alphaImage = alphaImage.negate();
  const {data, info} = await alphaImage.raw().toBuffer({resolveWithObject: true});
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let index = 0; index < data.length; index += info.channels) {
    const alpha = data[index];
    const output = (index / info.channels) * 4;
    rgba[output] = 255;
    rgba[output + 1] = 255;
    rgba[output + 2] = 255;
    rgba[output + 3] = alpha;
  }
  return {
    input: rgba,
    raw: {width: info.width, height: info.height, channels: 4},
  };
};

const clipMask = ({clip, canvas}) => {
  if (!clip) return null;
  const shape = clip.kind === 'rectangle'
    ? `<rect x="${clip.rect.left}" y="${clip.rect.top}" width="${clip.rect.width}" height="${clip.rect.height}" fill="white"/>`
    : `<polygon points="${clip.points.map(
        ([x, y]) => `${x * canvas.width},${y * canvas.height}`,
      ).join(' ')}" fill="white"/>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"><rect width="100%" height="100%" fill="transparent"/>${shape}</svg>`,
  );
};

const buildMemberImage = async ({
  root,
  manifest,
  member,
  registration,
  sourcePackage,
}) => {
  const source = await sourceImage({
    root,
    manifest,
    source: member.source,
    derivation: member.derivation,
    registration,
    sourcePackage: {
      ...sourcePackage,
      role: member.role,
      completeness: member.completeness,
    },
  });
  const canvas = registration.canvas;
  const placement = member.derivation.placement ?? {
    left: 0,
    top: 0,
    width: source.width,
    height: source.height,
  };
  if (
    !member.derivation.placement &&
    (source.width !== canvas.width || source.height !== canvas.height)
  ) {
    throw new Error(
      `${member.assetId} 的非完整画布来源必须显式声明 placement；不能把裁紧图片伪装成注册成员`,
    );
  }
  if (!rectWithin(placement, canvas)) {
    throw new Error(`${member.assetId} placement 越过注册画布`);
  }
  const placed = await sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: '#00000000',
    },
  }).composite([{
    input: await sharp(source.buffer)
      .resize(placement.width, placement.height, {fit: 'fill'})
      .png()
      .toBuffer(),
    left: placement.left,
    top: placement.top,
  }]).png().toBuffer();
  const masks = [];
  let maskRecord = null;
  let maskSha256 = null;
  if (member.derivation.maskAssetId) {
    maskRecord = assertImageRecord(
      manifest,
      member.derivation.maskAssetId,
      `${member.assetId} mask`,
    );
    const maskFile = workspacePath(root, maskRecord.file, 'registered family mask');
    maskSha256 = await sha256File(maskFile);
    if (maskRecord.sha256 !== maskSha256) {
      throw new Error(`${member.assetId} mask manifest hash 已漂移`);
    }
    masks.push({
      ...await rgbaMask({
        file: maskFile,
        channel: member.derivation.maskChannel,
        invert: member.derivation.invertMask,
        canvas,
      }),
      blend: 'dest-in',
    });
  }
  const clip = clipMask({clip: member.derivation.clip, canvas});
  if (clip) masks.push({input: clip, blend: 'dest-in'});
  let outputBuffer = placed;
  for (const mask of masks) {
    outputBuffer = await sharp(outputBuffer)
      .composite([mask])
      .png()
      .toBuffer();
  }
  const output = workspacePath(root, member.output, `${member.assetId} output`);
  if (!path.relative(root, output).startsWith(`public${path.sep}`)) {
    throw new Error(`${member.assetId} output 必须位于 public/ 内`);
  }
  await fs.mkdir(path.dirname(output), {recursive: true});
  await fs.writeFile(output, outputBuffer);
  const keyingMetadataFile = `${output}.key.json`;
  let keyingMetadataSha256 = null;
  if (source.keyingMetadata) {
    const keyingMetadata = {
      ...source.keyingMetadata,
      input: source.record.file,
      output: path.relative(root, output),
      sourceRect: source.sourceRect,
      sourceAssetId: source.record.assetId,
    };
    await fs.writeFile(
      keyingMetadataFile,
      `${JSON.stringify(keyingMetadata, null, 2)}\n`,
      'utf8',
    );
    keyingMetadataSha256 = await sha256File(keyingMetadataFile);
  } else {
    await fs.rm(keyingMetadataFile, {force: true});
  }
  const metadata = await imageMetadata(output);
  if (
    metadata.width !== canvas.width ||
    metadata.height !== canvas.height
  ) {
    throw new Error(`${member.assetId} 派生结果没有保留完整注册画布`);
  }
  const {data, info} = await sharp(output)
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer({resolveWithObject: true});
  let transparentPixels = 0;
  let visiblePixels = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    if (data[index] === 0) transparentPixels += 1;
    if (data[index] > 0) visiblePixels += 1;
  }
  if (visiblePixels === 0) throw new Error(`${member.assetId} 派生结果完全透明`);
  if (
    ['subject', 'support-front'].includes(member.role) &&
    transparentPixels === 0
  ) {
    throw new Error(`${member.assetId} 必须保留真实透明区域`);
  }
  const stat = await fs.stat(output);
  return {
    member,
    source,
    output,
    file: path.relative(root, output),
    sha256: await sha256File(output),
    sizeBytes: stat.size,
    media: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format ?? null,
      hasAlpha: metadata.hasAlpha === true,
    },
    placement,
    sourceRect: source.sourceRect ?? null,
    sourceSurface: source.sourceSurface ?? null,
    keying: source.keying ?? null,
    keyingMetadataSha256,
    maskRecord,
    maskSha256,
    transparentPixels,
    visiblePixels,
  };
};

export const createRegisteredFamilyFingerprint = ({
  spec,
  sourceRecords,
  members,
}) => sha256Value(JSON.stringify(stableValue({
  schemaVersion: 2,
  familyId: spec.familyId,
  pattern: spec.pattern,
  motionCapability: spec.motionCapability,
  sourcePackageId: spec.sourcePackageId,
  sourceStrategy: spec.sourceStrategy,
  revealEnvelope: spec.revealEnvelope,
  registration: spec.registration,
  recoveryPolicy: spec.recoveryPolicy,
  sources: sourceRecords.map((source) => ({
    assetId: source.record.assetId,
    sha256: source.sha256,
    lineage: source.lineage,
  })).sort((left, right) => left.assetId.localeCompare(right.assetId)),
  members: members.map((member) => ({
    assetId: member.member.assetId,
    role: member.member.role,
    slot: member.member.slot,
    completeness: member.member.completeness,
    output: member.file,
    source: member.source.lineage,
    placement: member.placement,
    sourceRect: member.sourceRect,
    sourceSurface: member.sourceSurface,
    keying: member.keying,
    keyingMetadataSha256: member.keyingMetadataSha256,
    maskAssetId: member.maskRecord?.assetId ?? null,
    maskSha256: member.maskSha256,
    clip: member.member.derivation.clip ?? null,
    sha256: member.sha256,
  })).sort((left, right) => left.role.localeCompare(right.role)),
})));

const providerRootsFor = (manifest, derivedMembers) => {
  const records = new Map();
  for (const member of derivedMembers) {
    const record = member.source.record;
    records.set(record.recordId, record);
  }
  return [...records.values()];
};

const providerPackageRootsFor = (manifest, spec, derivedMembers) => {
  return providerRootsFor(manifest, derivedMembers);
};

export const deriveRegisteredFamily = async ({
  root,
  spec,
  manifest,
  now = new Date().toISOString(),
}) => {
  const errors = validateRegisteredFamilySpec(spec);
  if (errors.length) {
    throw new Error(`registered family spec 无效：${errors.join('；')}`);
  }
  assertAssetManifest(manifest, spec.projectSlug);
  const members = [];
  for (const member of spec.members) {
    members.push(await buildMemberImage({
      root,
      manifest,
      member,
      registration: spec.registration,
      sourcePackage: {
        id: spec.sourcePackageId,
        strategy: spec.sourceStrategy,
      },
    }));
  }
  const familyFingerprint = createRegisteredFamilyFingerprint({
    spec,
    sourceRecords: members.map(({source}) => source),
    members,
  });
  const records = members.map((derived) => {
    const member = derived.member;
    const requestFingerprint = sha256Value(
      `${familyFingerprint}\0${member.assetId}\0${derived.sha256}`,
    );
    const registeredFamilyBinding = {
      schemaVersion: 2,
      familyId: spec.familyId,
      pattern: spec.pattern,
      motionCapability: spec.motionCapability,
      sourcePackageId: spec.sourcePackageId,
      sourceStrategy: spec.sourceStrategy,
      revealEnvelope: spec.revealEnvelope,
      registrationId: spec.registration.id,
      sourceMasterAssetId: spec.registration.sourceMasterAssetId,
      canvas: spec.registration.canvas,
      origin: spec.registration.origin,
      role: member.role,
      slot: member.slot,
      completeness: member.completeness,
      nodeId: member.nodeId,
      source: {
        ...derived.source.lineage,
        sha256: derived.source.sha256,
      },
      derivation: {
        placement: derived.placement,
        sourceRect: derived.sourceRect,
        sourceSurface: derived.sourceSurface,
        keying: derived.keying,
        keyingMetadataSha256: derived.keyingMetadataSha256,
        maskAssetId: derived.maskRecord?.assetId ?? null,
        maskSha256: derived.maskSha256,
        maskChannel: member.derivation.maskChannel ?? null,
        invertMask: member.derivation.invertMask ?? false,
        clip: member.derivation.clip ?? null,
        trimmed: false,
        outputCanvasPreserved: true,
      },
      recoveryPolicy: spec.recoveryPolicy,
      familyFingerprint,
    };
    return {
      recordId: createAssetRecordId({
        assetId: member.assetId,
        requestFingerprint,
        sha256: derived.sha256,
        recordedAt: now,
      }),
      assetId: member.assetId,
      capability: 'image',
      file: derived.file,
      provider: 'local-derivation',
      adapter: 'registered-family-member',
      tool: 'derive-registered-family',
      model: null,
      externalId: null,
      attemptId: null,
      requestFingerprint,
      reusedFrom: derived.source.record.assetId,
      sha256: derived.sha256,
      sizeBytes: derived.sizeBytes,
      media: derived.media,
      recordedAt: now,
      request: {},
      compositionBinding: {
        sceneId: spec.sceneId,
        nodeId: member.nodeId,
        pattern: spec.pattern,
        registrationId: spec.registration.id,
        sourceMasterAssetId: spec.registration.sourceMasterAssetId,
        outputRole: member.role,
        canvas: spec.registration.canvas,
        derivation: {
          method: derived.keying
            ? 'alpha-extraction'
            : member.derivation.maskAssetId
            ? 'mask-application'
            : member.derivation.clip
              ? 'mask-application'
              : 'crop',
          parentAssetId: derived.source.record.assetId,
        },
      },
      stateBinding: null,
      stateSheetBinding: null,
      stateSheetRecoveryBinding: null,
      sourceSheetAssetId: derived.source.lineage.sourceSheetAssetId,
      registeredFamilyBinding,
      semanticBinding: derived.source.record.semanticBinding ??
        derived.source.record.request?.semanticBinding ??
        null,
      familyFingerprint,
      lifecycle: {
        status: 'active',
        changedAt: now,
        reason: 'registered-family-local-derivative',
        supersededBy: null,
      },
    };
  });
  const replacementById = new Map(records.map((record) => [record.assetId, record]));
  const derivedIds = new Set(replacementById.keys());
  for (const previous of manifest.assets.filter(
    ({assetId, lifecycle}) =>
      derivedIds.has(assetId) && lifecycle?.status === 'active',
  )) {
    previous.lifecycle = {
      status: 'superseded',
      changedAt: now,
      reason: 'replaced-by-new-registered-family-derivative',
      supersededBy: replacementById.get(previous.assetId).recordId,
    };
  }
  manifest.assets.push(...records);
  assertAssetManifest(manifest, spec.projectSlug);
  const providerRoots = providerPackageRootsFor(manifest, spec, members);
  const providerImageCalls = providerRoots.filter(
    (record) =>
      ['host', 'command'].includes(record.adapter) &&
      !record.reusedFrom,
  ).length;
  const localDerivatives = records.length;
  const avoidedCalls =
    spec.sourceStrategy === 'registered-layer-sheet' ? 3 : 0;
  return {
    manifest,
    records,
    familyFingerprint,
    report: {
      schemaVersion: 2,
      projectSlug: spec.projectSlug,
      sceneId: spec.sceneId,
      groupId: spec.groupId,
      familyId: spec.familyId,
      pattern: spec.pattern,
      motionCapability: spec.motionCapability,
      sourcePackageId: spec.sourcePackageId,
      sourceStrategy: spec.sourceStrategy,
      revealEnvelope: spec.revealEnvelope,
      registration: spec.registration,
      familyFingerprint,
      sourceAssetIds: [...new Set(members.map(({source}) => source.record.assetId))],
      providerImageCalls,
      localDerivatives,
      avoidedCalls,
      recoveryPolicy: spec.recoveryPolicy,
      members: records.map((record) => ({
        assetId: record.assetId,
        file: record.file,
        role: record.registeredFamilyBinding.role,
        slot: record.registeredFamilyBinding.slot,
        completeness: record.registeredFamilyBinding.completeness,
        sha256: record.sha256,
        canvas: record.registeredFamilyBinding.canvas,
        source: record.registeredFamilyBinding.source,
        derivation: record.registeredFamilyBinding.derivation,
      })),
      createdAt: now,
    },
  };
};

export const applyRegisteredFamilyToProject = ({project, spec, records}) => {
  const scene = (project.scenes ?? []).find(({id}) => id === spec.sceneId);
  if (!scene) throw new Error(`项目没有 scene：${spec.sceneId}`);
  const stack = [...(scene.composition?.nodes ?? [])];
  let group = null;
  while (stack.length) {
    const node = stack.shift();
    if (node?.id === spec.groupId) group = node;
    if (node?.kind === 'group') stack.push(...(node.children ?? []));
  }
  if (
    !group ||
    group.kind !== 'group' ||
    group.pattern !== spec.pattern
  ) {
    throw new Error(
      `groupId 必须指向 ${spec.pattern} group：${spec.groupId}`,
    );
  }
  const recordsByRole = new Map(
    records.map((record) => [record.registeredFamilyBinding.role, record]),
  );
  const membersByRole = new Map(spec.members.map((member) => [member.role, member]));
  for (const role of REGISTERED_FAMILY_ROLES) {
    const memberSpec = membersByRole.get(role);
    const node = (group.children ?? []).find(
      (child) =>
        child.id === memberSpec.nodeId &&
        child.kind === 'asset' &&
        child.slot === role,
    );
    if (!node) {
      throw new Error(
        `${spec.groupId} 缺少可由 registered-family 绑定的 ${role} asset node ${memberSpec.nodeId}`,
      );
    }
    const record = recordsByRole.get(role);
    const publicPrefix = `public${path.sep}`;
    const normalized = path.normalize(record.file);
    if (!normalized.startsWith(publicPrefix)) {
      throw new Error(`${record.assetId} 不在 public/ 内`);
    }
    node.src = normalized.slice(publicPrefix.length).split(path.sep).join('/');
    node.registrationId = spec.registration.id;
  }
  group.registration = spec.registration;
  group.coordinateSpace = {...spec.registration.canvas};
  if (spec.pattern === 'registered-depth-stack') {
    group.layerStack = {
      sourcePackageId: spec.sourcePackageId,
      sourceStrategy: spec.sourceStrategy,
      motionCapability: spec.motionCapability,
      revealEnvelope: spec.revealEnvelope,
    };
  }
  return project;
};

export const assertRegisteredFamilyRecords = ({
  records,
  registration,
  familyId = null,
  pattern = null,
  sourcePackageId = null,
}) => {
  const roles = new Set();
  const fingerprints = new Set();
  const familyIds = new Set();
  const errors = [];
  for (const record of records) {
    const binding = record?.registeredFamilyBinding;
    if (!binding) {
      errors.push(`${record?.assetId ?? 'missing'} 缺少 registeredFamilyBinding`);
      continue;
    }
    roles.add(binding.role);
    fingerprints.add(binding.familyFingerprint);
    familyIds.add(binding.familyId);
    if (
      record.adapter !== 'registered-family-member' ||
      binding.schemaVersion !== 2 ||
      record.lifecycle?.status !== 'active' ||
      binding.registrationId !== registration.id ||
      binding.sourceMasterAssetId !== registration.sourceMasterAssetId ||
      binding.canvas?.width !== registration.canvas.width ||
      binding.canvas?.height !== registration.canvas.height ||
      binding.origin !== 'top-left' ||
      binding.derivation?.trimmed !== false ||
      binding.derivation?.outputCanvasPreserved !== true ||
      binding.role !== binding.slot ||
      binding.completeness !==
        REGISTERED_FAMILY_COMPLETENESS[binding.role] ||
      binding.motionCapability !== 'bounded-relative' ||
      !REGISTERED_FAMILY_PATTERNS.includes(binding.pattern) ||
      !REGISTERED_FAMILY_SOURCE_STRATEGIES.includes(
        binding.sourceStrategy,
      ) ||
      !nonEmpty(binding.sourcePackageId) ||
      !nonEmpty(binding.nodeId) ||
      !sameValue(binding.recoveryPolicy, REGISTERED_FAMILY_RECOVERY_POLICY) ||
      record.media?.width !== registration.canvas.width ||
      record.media?.height !== registration.canvas.height ||
      record.familyFingerprint !== binding.familyFingerprint
    ) {
      errors.push(`${record.assetId} 没有保持 active 完整共享注册画布契约`);
    }
    if (familyId && binding.familyId !== familyId) {
      errors.push(`${record.assetId} familyId 不匹配`);
    }
    if (pattern && binding.pattern !== pattern) {
      errors.push(`${record.assetId} pattern 不匹配`);
    }
    if (
      sourcePackageId &&
      binding.sourcePackageId !== sourcePackageId
    ) {
      errors.push(`${record.assetId} sourcePackageId 不匹配`);
    }
    if (
      binding.derivation?.sourceSurface?.mode === 'chroma-key' &&
      (
        !binding.derivation.keying ||
        !/^[a-f0-9]{64}$/.test(
          binding.derivation.keyingMetadataSha256 ?? '',
        )
      )
    ) {
      errors.push(`${record.assetId} 色键来源缺少正式 keying provenance`);
    }
    if (
      binding.derivation?.sourceSurface?.observedKeyColor &&
      (
        !binding.derivation.sourceSurface.observationPolicyId ||
        !/^[a-f0-9]{64}$/.test(
          binding.derivation.sourceSurface.observationPolicyFingerprint ?? '',
        ) ||
        !/^[a-f0-9]{64}$/.test(
          binding.derivation.sourceSurface.observationFingerprint ?? '',
        ) ||
        binding.derivation.keying?.keyColor?.toLowerCase() !==
          binding.derivation.sourceSurface.observedKeyColor.toLowerCase()
      )
    ) {
      errors.push(`${record.assetId} observed key plane provenance 不完整或与 keying 不一致`);
    }
    if (
      binding.derivation?.sourceSurface?.mode !== 'chroma-key' &&
      (
        binding.derivation?.keying != null ||
        binding.derivation?.keyingMetadataSha256 != null
      )
    ) {
      errors.push(`${record.assetId} 非色键来源不得携带 keying provenance`);
    }
  }
  for (const role of REGISTERED_FAMILY_ROLES) {
    if (!roles.has(role)) errors.push(`registered family 缺少 ${role}`);
  }
  if (records.length !== REGISTERED_FAMILY_ROLES.length) {
    errors.push('registered family 必须恰好包含三个 active 成员');
  }
  if (familyIds.size !== 1) errors.push('registered family 成员 familyId 不一致');
  if (fingerprints.size !== 1) errors.push('registered family 成员 fingerprint 不一致');
  return {passed: errors.length === 0, errors};
};

export const assertRegisteredFamilyGroupMembers = ({
  group,
  members,
  allRecords = [],
}) => {
  const errors = [];
  const activeMembers = (members ?? []).filter(
    ({node}) => ['asset', 'state-sequence'].includes(node?.kind),
  );
  const bySlot = new Map();
  for (const member of activeMembers) {
    if (!REGISTERED_FAMILY_ROLES.includes(member.node?.slot)) {
      errors.push(`${member.node?.id ?? 'missing'} 缺少合法 registered family slot`);
      continue;
    }
    if (bySlot.has(member.node.slot)) {
      errors.push(`registered family active slot 重复：${member.node.slot}`);
      continue;
    }
    bySlot.set(member.node.slot, member);
  }
  for (const role of REGISTERED_FAMILY_ROLES) {
    if (!bySlot.has(role)) errors.push(`registered family 缺少 active ${role}`);
  }
  if (activeMembers.length !== REGISTERED_FAMILY_ROLES.length) {
    errors.push('registered family 必须恰好包含三个 active 视觉成员');
  }

  const records = activeMembers.flatMap(({records: memberRecords}) =>
    memberRecords ?? [],
  );
  const sourcePackageIds = new Set();
  const sourceStrategies = new Set();
  const familyIds = new Set();
  for (const {node, records: memberRecords = []} of activeMembers) {
    const expectedSources =
      node.kind === 'state-sequence'
        ? node.states?.length ?? 0
        : 1;
    if (memberRecords.length !== expectedSources || memberRecords.some((record) => !record)) {
      errors.push(`${node.id} 的 registered family 来源记录不完整`);
      continue;
    }
    for (const record of memberRecords) {
      const binding = record.registeredFamilyBinding;
      if (
        !binding ||
        record.adapter !== 'registered-family-member' ||
        record.lifecycle?.status !== 'active' ||
        binding.role !== node.slot ||
        binding.slot !== node.slot ||
        binding.registrationId !== group.registration?.id ||
        binding.sourceMasterAssetId !==
          group.registration?.sourceMasterAssetId ||
        binding.canvas?.width !== group.registration?.canvas?.width ||
        binding.canvas?.height !== group.registration?.canvas?.height ||
        binding.origin !== 'top-left' ||
        binding.pattern !== group.pattern ||
        binding.motionCapability !== 'bounded-relative'
      ) {
        errors.push(`${record?.assetId ?? node.id} 没有保持 active 状态成员注册契约`);
        continue;
      }
      if (node.kind === 'asset' && binding.nodeId !== node.id) {
        errors.push(`${record.assetId} nodeId 与 active 成员 ${node.id} 不一致`);
      }
      sourcePackageIds.add(binding.sourcePackageId);
      sourceStrategies.add(binding.sourceStrategy);
      familyIds.add(binding.familyId);
    }
  }

  const expectedSourcePackageId =
    group.pattern === 'registered-depth-stack'
      ? group.layerStack?.sourcePackageId
      : null;
  if (sourcePackageIds.size !== 1) {
    errors.push('registered family 状态变体 sourcePackageId 不一致');
  } else if (
    expectedSourcePackageId &&
    !sourcePackageIds.has(expectedSourcePackageId)
  ) {
    errors.push('registered family 状态变体 sourcePackageId 与景深组不一致');
  }
  if (sourceStrategies.size !== 1) {
    errors.push('registered family 状态变体 sourceStrategy 不一致');
  }

  const contextRecords = allRecords.length > 0 ? allRecords : records;
  for (const familyId of familyIds) {
    const familyRecords = contextRecords.filter(
      (record) =>
        record?.lifecycle?.status === 'active' &&
        record?.registeredFamilyBinding?.familyId === familyId,
    );
    const result = assertRegisteredFamilyRecords({
      records: familyRecords,
      registration: group.registration,
      familyId,
      pattern: group.pattern,
      sourcePackageId: expectedSourcePackageId,
    });
    if (!result.passed) {
      errors.push(
        `registered family 状态来源 ${familyId} 上下文不完整：${result.errors.join('；')}`,
      );
    }
  }
  return {
    passed: errors.length === 0,
    errors,
    familyIds: [...familyIds].sort(),
    stateful: activeMembers.some(({node}) => node.kind === 'state-sequence'),
  };
};
