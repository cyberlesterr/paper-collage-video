import {stableValue} from './contract-utils.mjs';
import {CANONICAL_CONTAINER_SOURCE_STRATEGY} from './production-vocabulary.mjs';

export {CANONICAL_CONTAINER_SOURCE_STRATEGY};

const finite = (value) =>
  typeof value === 'number' && Number.isFinite(value);

const nonEmpty = (value) =>
  typeof value === 'string' && value.trim().length > 0;

const addIssue = (issues, code, message, location) =>
  issues.push({code, message, location});

const sameValue = (left, right) =>
  JSON.stringify(stableValue(left)) ===
  JSON.stringify(stableValue(right));

export const CANONICAL_CONTAINER_RECOVERY_POLICY = {
  strategy: 'preserve-content-sheet-context',
  localDeterministicFixFirst: true,
  isolatedStateGeneration: 'forbidden',
  providerRepair: 'masked-complete-sheet-edit',
  fallback: 'full-content-sheet-regeneration',
};

export const CANONICAL_CONTAINER_FRAME_REDRAW_POLICY =
  'forbidden-in-content-states';

export const CANONICAL_CONTAINER_DUPLICATE_SURFACE_POLICY =
  'single-authoritative-state-sequence';

const comparableContainerStates = (states = []) =>
  states.map(({stateId, id, row, column, at, fillLevel}) => ({
    id: stateId ?? id,
    row,
    column,
    at,
    fillLevel,
  }));

export const canonicalContainerPackageBindingMatchesPlan = ({
  binding,
  plan,
}) => {
  if (!binding || !plan) return false;
  const comparableKeys = [
    'familyId',
    'sourcePackageId',
    'sourceStrategy',
    'registrationId',
    'sourceMasterAssetId',
    'canvas',
    'cleanPlateAssetId',
    'canonicalFrameAssetId',
    'contentSheetAssetId',
    'interiorMaskAssetId',
    'authoritativeSurfaceId',
    'sheetLayout',
    'interiorShape',
    'alignmentPolicy',
    'terminalStateId',
    'terminalPolicy',
    'recoveryPolicy',
    'frameRedrawPolicy',
    'duplicateSurfacePolicy',
  ];
  return (
    comparableKeys.every((key) => sameValue(binding[key], plan[key])) &&
    sameValue(
      comparableContainerStates(binding.states),
      comparableContainerStates(plan.states),
    )
  );
};

const polygonArea = (points = []) =>
  Math.abs(
    points.reduce((sum, [x, y], index) => {
      const [nextX, nextY] = points[(index + 1) % points.length] ?? [];
      return sum + x * nextY - nextX * y;
    }, 0),
  ) / 2;

export const validateCanonicalContainerIntent = (
  composition,
  {
    location = 'composition',
    treatment = null,
  } = {},
) => {
  const issues = [];
  const containerAware =
    composition?.pattern === 'canonical-container' ||
    composition?.container !== undefined;
  if (!containerAware) return issues;
  if (composition?.pattern !== 'canonical-container') {
    addIssue(
      issues,
      'container-pattern',
      'composition.container 只能用于 canonical-container。',
      `${location}.pattern`,
    );
    return issues;
  }
  const intent = composition.container;
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
    addIssue(
      issues,
      'container-intent-required',
      'canonical-container 必须声明完整 container intent。',
      `${location}.container`,
    );
    return issues;
  }
  for (const key of [
    'groupId',
    'familyId',
    'sourcePackageId',
    'registrationId',
    'sourceMasterAssetId',
    'cleanPlateAssetId',
    'canonicalFrameAssetId',
    'contentSheetAssetId',
    'interiorMaskAssetId',
    'authoritativeSurfaceId',
    'terminalStateId',
  ]) {
    if (!nonEmpty(intent[key])) {
      addIssue(
        issues,
        'container-field-required',
        `container.${key} 不能为空。`,
        `${location}.container.${key}`,
      );
    }
  }
  if (
    intent.sourceStrategy !== CANONICAL_CONTAINER_SOURCE_STRATEGY
  ) {
    addIssue(
      issues,
      'container-source-strategy',
      `容器必须使用 ${CANONICAL_CONTAINER_SOURCE_STRATEGY}：一张无容器底图、一张唯一瓶体前框、一张仅含内部内容的状态表。`,
      `${location}.container.sourceStrategy`,
    );
  }
  if (
    !Number.isInteger(intent.canvas?.width) ||
    intent.canvas.width < 1 ||
    !Number.isInteger(intent.canvas?.height) ||
    intent.canvas.height < 1
  ) {
    addIssue(
      issues,
      'container-canvas',
      'container.canvas 必须是有效整数画布。',
      `${location}.container.canvas`,
    );
  }
  const sourceIds = [
    intent.cleanPlateAssetId,
    intent.canonicalFrameAssetId,
    intent.contentSheetAssetId,
    intent.interiorMaskAssetId,
  ].filter(nonEmpty);
  if (new Set(sourceIds).size !== sourceIds.length) {
    addIssue(
      issues,
      'container-source-identity',
      'clean plate、canonical frame、content sheet 与 interior mask 必须使用不同资产 id。',
      `${location}.container`,
    );
  }
  const points = intent.interiorShape?.points;
  if (
    intent.interiorShape?.kind !== 'polygon' ||
    !Array.isArray(points) ||
    points.length < 4 ||
    points.some(
      (point) =>
        !Array.isArray(point) ||
        point.length !== 2 ||
        !point.every(
          (value) => finite(value) && value >= 0 && value <= 1,
        ),
    ) ||
    polygonArea(points) < 0.005
  ) {
    addIssue(
      issues,
      'container-interior-shape',
      'interiorShape 必须是位于 0..1、面积可读的至少四点 polygon。',
      `${location}.container.interiorShape`,
    );
  }
  const alignment = intent.alignmentPolicy;
  if (
    alignment?.mode !== 'center-bottom' ||
    ![
      'maximumTranslationX',
      'maximumTranslationY',
      'maximumCenterDrift',
      'maximumBottomGap',
      'maximumFillLevelDeviation',
      'minimumInteriorRetention',
    ].every((key) => finite(alignment?.[key]) && alignment[key] >= 0)
  ) {
    addIssue(
      issues,
      'container-alignment-policy',
      '容器内容必须声明 center-bottom 自动注册及完整偏差上限。',
      `${location}.container.alignmentPolicy`,
    );
  }
  const states = intent.states;
  const sheetLayout = intent.sheetLayout;
  if (
    !Number.isInteger(sheetLayout?.columns) ||
    sheetLayout.columns < 1 ||
    sheetLayout.columns > 4 ||
    !Number.isInteger(sheetLayout?.rows) ||
    sheetLayout.rows < 1 ||
    sheetLayout.rows > 4
  ) {
    addIssue(
      issues,
      'container-sheet-layout',
      'canonical-container 必须声明有效的 1..4 状态表网格。',
      `${location}.container.sheetLayout`,
    );
  }
  if (
    !Array.isArray(states) ||
    states.length < 2 ||
    (
      Number.isInteger(sheetLayout?.columns) &&
      Number.isInteger(sheetLayout?.rows) &&
      states.length > sheetLayout.columns * sheetLayout.rows
    )
  ) {
    addIssue(
      issues,
      'container-states',
      'canonical-container 至少需要两个内部内容状态。',
      `${location}.container.states`,
    );
  } else {
    const ids = new Set();
    const cells = new Set();
    let previousAt = -Infinity;
    let previousFill = -Infinity;
    for (const [index, state] of states.entries()) {
      const stateLocation = `${location}.container.states[${index}]`;
      if (!nonEmpty(state?.id) || ids.has(state.id)) {
        addIssue(
          issues,
          'container-state-id',
          'container state id 必须非空且唯一。',
          `${stateLocation}.id`,
        );
      }
      ids.add(state?.id);
      const cell = `${state?.row}:${state?.column}`;
      if (
        !Number.isInteger(state?.row) ||
        state.row < 0 ||
        state.row >= (sheetLayout?.rows ?? 0) ||
        !Number.isInteger(state?.column) ||
        state.column < 0 ||
        state.column >= (sheetLayout?.columns ?? 0) ||
        cells.has(cell)
      ) {
        addIssue(
          issues,
          'container-state-cell',
          'container state 必须引用状态表内的唯一 row/column 格位。',
          stateLocation,
        );
      }
      cells.add(cell);
      if (
        !finite(state?.at) ||
        state.at < 0 ||
        state.at > 1 ||
        state.at <= previousAt
      ) {
        addIssue(
          issues,
          'container-state-time',
          'container states 必须按严格递增的 0..1 at 编排。',
          `${stateLocation}.at`,
        );
      }
      previousAt = state?.at ?? previousAt;
      if (
        !finite(state?.fillLevel) ||
        state.fillLevel < 0 ||
        state.fillLevel > 1 ||
        state.fillLevel <= previousFill
      ) {
        addIssue(
          issues,
          'container-fill-order',
          'container states 必须按严格递增、可量化的 fillLevel 编排。',
          `${stateLocation}.fillLevel`,
        );
      }
      previousFill = state?.fillLevel ?? previousFill;
    }
    const terminal = states.find(({id}) => id === intent.terminalStateId);
    if (!terminal) {
      addIssue(
        issues,
        'container-terminal-state',
        'terminalStateId 必须引用已声明状态。',
        `${location}.container.terminalStateId`,
      );
    } else {
      if (terminal !== states.at(-1)) {
        addIssue(
          issues,
          'container-terminal-order',
          'terminalStateId 必须是最高 fillLevel 的最后状态。',
          `${location}.container.terminalStateId`,
        );
      }
      if (
        finite(intent.terminalPolicy?.minimumFillLevel) &&
        terminal.fillLevel < intent.terminalPolicy.minimumFillLevel
      ) {
        addIssue(
          issues,
          'container-terminal-fill',
          '终态声明 fillLevel 低于 terminalPolicy.minimumFillLevel。',
          `${location}.container.terminalPolicy.minimumFillLevel`,
        );
      }
    }
  }
  const terminalPolicy = intent.terminalPolicy;
  if (
    ![
      terminalPolicy?.minimumFillLevel,
      terminalPolicy?.maximumRimGap,
      terminalPolicy?.minimumBottomBandCoverage,
    ].every((value) => finite(value) && value >= 0 && value <= 1) ||
    !(
      finite(terminalPolicy?.bottomBandHeight) &&
      terminalPolicy.bottomBandHeight > 0 &&
      terminalPolicy.bottomBandHeight <= 0.2
    )
  ) {
    addIssue(
      issues,
      'container-terminal-policy',
      'terminalPolicy 必须声明可量化的 fill、rim gap 与 bottom band 阈值。',
      `${location}.container.terminalPolicy`,
    );
  }
  if (!sameValue(intent.recoveryPolicy, CANONICAL_CONTAINER_RECOVERY_POLICY)) {
    addIssue(
      issues,
      'container-recovery-policy',
      '内容状态恢复必须保留整张状态表上下文，禁止独立生成单一水位。',
      `${location}.container.recoveryPolicy`,
    );
  }
  if (treatment) {
    if (
      treatment.motion?.kind !== 'state-sequence' ||
      treatment.changeClass !== 'mechanism-state' ||
      treatment.semanticRisk !== 'mechanism'
    ) {
      addIssue(
        issues,
        'container-treatment-route',
        'canonical-container 必须由 mechanism-state/state-sequence/mechanism 风险路径执行。',
        location.replace(/\.composition$/, ''),
      );
    }
    if (
      treatment.motion?.poseFamilyId !== intent.familyId ||
      !intent.states?.some(({id}) => id === treatment.motion?.stateId)
    ) {
      addIssue(
        issues,
        'container-state-route',
        '状态 treatment 必须使用 container.familyId，并引用 container.states 中的状态。',
        `${location}.container.states`,
      );
    }
  }
  return issues;
};

export const compileCanonicalContainerPlan = ({
  sceneId,
  treatment,
}) => {
  if (treatment.composition?.pattern !== 'canonical-container') return null;
  const intent = treatment.composition.container;
  return {
    id: intent.sourcePackageId,
    treatmentId: treatment.id,
    sceneId,
    targetId: treatment.targetId,
    groupId: intent.groupId,
    pattern: 'canonical-container',
    familyId: intent.familyId,
    sourcePackageId: intent.sourcePackageId,
    sourceStrategy: intent.sourceStrategy,
    registrationId: intent.registrationId,
    sourceMasterAssetId: intent.sourceMasterAssetId,
    canvas: intent.canvas,
    cleanPlateAssetId: intent.cleanPlateAssetId,
    canonicalFrameAssetId: intent.canonicalFrameAssetId,
    contentSheetAssetId: intent.contentSheetAssetId,
    interiorMaskAssetId: intent.interiorMaskAssetId,
    authoritativeSurfaceId: intent.authoritativeSurfaceId,
    sheetLayout: intent.sheetLayout,
    interiorShape: intent.interiorShape,
    alignmentPolicy: intent.alignmentPolicy,
    states: intent.states,
    terminalStateId: intent.terminalStateId,
    terminalPolicy: intent.terminalPolicy,
    recoveryPolicy: intent.recoveryPolicy,
    frameRedrawPolicy: CANONICAL_CONTAINER_FRAME_REDRAW_POLICY,
    duplicateSurfacePolicy:
      CANONICAL_CONTAINER_DUPLICATE_SURFACE_POLICY,
    providerImageCalls: 3,
    localDerivatives: intent.states.length + 1,
    avoidedCalls: Math.max(1, intent.states.length - 1),
    proofTimeId: treatment.proofTimeId ?? null,
  };
};

export const collectCanonicalContainerPlans = (scenes) =>
  scenes
    .flatMap((scene) => scene.compositionPlan?.canonicalContainers ?? [])
    .sort(
      (left, right) =>
        left.sceneId.localeCompare(right.sceneId) ||
        left.groupId.localeCompare(right.groupId),
    );
