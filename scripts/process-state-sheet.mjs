#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {ROOT, fileExists, readJson, writeJson} from './project-lib.mjs';
import {resolvePythonCommand} from './python-runtime.mjs';
import {
  createStateFamilyFingerprint,
  inspectStateAnchorRegistration,
  resolveOutputStateRegistration,
  stateOutputName,
  validateStateSheetSpec,
} from './state-sheet-lib.mjs';
import {
  assertAssetManifest,
  createAssetRecordId,
  transactAssetManifest,
} from './asset-manifest-lib.mjs';

const USAGE =
  '用法：process-state-sheet.mjs <state-sheet.json>';
printCliHelp(process.argv.slice(2), USAGE);

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {cwd: ROOT, stdio: 'inherit'});
  child.once('error', reject);
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`)));
});

const workspacePath = (input, label) => {
  const resolved = path.resolve(ROOT, input);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) throw new Error(`${label}越过工作区：${input}`);
  return resolved;
};

const sha256 = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');

const explicitExtractionFor = ({spec, state}) =>
  spec.extraction?.cells.find(({stateId}) => stateId === state.id) ?? null;

const stateObservationFor = ({source, stateId}) =>
  source.providerObservation?.cells?.find(
    (cell) => cell.packageRole === 'state' && cell.stateId === stateId,
  ) ?? null;

const assertExtractionFitsSource = ({cell, sourceMetadata}) => {
  const rect = cell.sourceRect;
  if (
    rect.left + rect.width > sourceMetadata.width ||
    rect.top + rect.height > sourceMetadata.height
  ) {
    throw new Error(
      `state ${cell.stateId} 的 extraction.sourceRect 越过 provider 原始画布`,
    );
  }
};

const keyBackgroundFor = async ({input, keyColor}) => {
  if (/^#[0-9a-f]{6}$/i.test(keyColor)) {
    return {
      r: Number.parseInt(keyColor.slice(1, 3), 16),
      g: Number.parseInt(keyColor.slice(3, 5), 16),
      b: Number.parseInt(keyColor.slice(5, 7), 16),
      alpha: 1,
    };
  }
  const {data} = await sharp(input)
    .removeAlpha()
    .extract({left: 0, top: 0, width: 1, height: 1})
    .raw()
    .toBuffer({resolveWithObject: true});
  return {r: data[0], g: data[1], b: data[2], alpha: 1};
};

const writeExplicitRegisteredCell = async ({
  input,
  destination,
  cell,
  canvas,
  keyBackground,
}) => {
  const {sourceRect, placement} = cell;
  const extend = {
    top: placement.top,
    left: placement.left,
    right: canvas.width - placement.left - sourceRect.width,
    bottom: canvas.height - placement.top - sourceRect.height,
    background: keyBackground,
  };
  await sharp(input)
    .extract(sourceRect)
    .extend(extend)
    .png()
    .toFile(destination);
};

const writeAnchorOverlay = async ({input, output, anchors, width, height}) => {
  const marks = anchors.map(({id, x, y}, index) => {
    const cx = Math.round(x * width);
    const cy = Math.round(y * height);
    const color = ['#ff3b30', '#007aff', '#34c759', '#ff9500'][index % 4];
    return `
      <circle cx="${cx}" cy="${cy}" r="8" fill="none" stroke="${color}" stroke-width="3"/>
      <line x1="${cx - 14}" y1="${cy}" x2="${cx + 14}" y2="${cy}" stroke="${color}" stroke-width="2"/>
      <line x1="${cx}" y1="${cy - 14}" x2="${cx}" y2="${cy + 14}" stroke="${color}" stroke-width="2"/>
      <text x="${cx + 11}" y="${cy - 11}" fill="${color}" font-size="18">${id.replace(/[<>&"]/g, '')}</text>
    `;
  }).join('');
  await sharp(input)
    .composite([{
      input: Buffer.from(
        `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${marks}</svg>`,
      ),
    }])
    .png()
    .toFile(output);
};

try {
  const [specInput] = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  if (!specInput) throw new Error(USAGE);
  const specFile = workspacePath(specInput, 'state sheet spec');
  const spec = await readJson(specFile);
  const errors = validateStateSheetSpec(spec);
  if (errors.length) throw new Error(`state sheet 无效：${errors.join('；')}`);

  const input = workspacePath(spec.input, 'state sheet input');
  const outputDirectory = workspacePath(spec.outputDirectory, 'state sheet outputDirectory');
  if (!(await fileExists(input))) throw new Error(`state sheet input 不存在：${spec.input}`);
  const manifestFile = path.join(ROOT, 'projects', spec.projectSlug, 'assets-manifest.json');
  const manifest = assertAssetManifest(await readJson(manifestFile), spec.projectSlug);
  const source = manifest.assets.find(({assetId, lifecycle}) =>
    assetId === spec.sourceAssetId &&
    ['active', 'recovery-source'].includes(lifecycle?.status));
  if (!source || path.resolve(ROOT, source.file) !== input) {
    throw new Error(
      'sourceAssetId 必须指向 provider 已登记的 active 或 recovery-source sheet input',
    );
  }
  const sourceBinding = source.stateSheetBinding ?? source.request?.stateSheetBinding;
  if (!sourceBinding || sourceBinding.poseFamilyId !== spec.poseFamilyId || sourceBinding.layout.columns !== spec.layout.columns || sourceBinding.layout.rows !== spec.layout.rows) throw new Error('state sheet spec 必须匹配 source asset 的 stateSheetBinding');
  const sourceStates = sourceBinding.states?.map(
    ({stateId, row, column, facing, anchors}) => ({
      id: stateId,
      row,
      column,
      facing,
      anchors,
    }),
  ) ?? [];
  const specSourceStates = spec.states.map(
    ({orientationTransform, ...state}) => state,
  );
  if (JSON.stringify(sourceStates) !== JSON.stringify(specSourceStates)) throw new Error('state sheet spec 必须覆盖 source asset 的完整有序姿态族，不能只处理或替换单格');
  if (
    sourceBinding.identityReferenceAssetId !== spec.identityReference.assetId ||
    JSON.stringify(sourceBinding.anchorPolicy) !== JSON.stringify(spec.anchorPolicy)
  ) {
    throw new Error('state sheet spec 的 identityReference/anchorPolicy 必须与 source stateSheetBinding 完全一致');
  }
  const identityReference = manifest.assets.find(
    ({assetId, lifecycle}) =>
      assetId === spec.identityReference.assetId &&
      lifecycle?.status === 'active',
  );
  if (!identityReference?.sha256) {
    throw new Error('identityReference.assetId 必须指向 manifest 中含 SHA-256 的 active 参考资产');
  }
  const recoveryPolicy = sourceBinding.recoveryPolicy;
  if (recoveryPolicy?.strategy !== 'preserve-sheet-context' || recoveryPolicy.localDeterministicFixFirst !== true || recoveryPolicy.isolatedCellGeneration !== 'forbidden' || recoveryPolicy.fallback !== 'full-sheet-regeneration') throw new Error('source state sheet 缺少 preserve-sheet-context 恢复策略');
  if (source.lifecycle?.status === 'recovery-source') {
    const observedStateIds = new Set(
      (source.providerObservation?.cells ?? [])
        .filter(
          ({packageRole, stateId, passed, observedKeyColor}) =>
            packageRole === 'state' &&
            typeof stateId === 'string' &&
            passed === true &&
            /^#[0-9a-f]{6}$/i.test(observedKeyColor ?? ''),
        )
        .map(({stateId}) => stateId),
    );
    if (
      source.providerObservation?.mode !== 'provider-native-observed' ||
      source.providerObservation?.sourceAttempt?.status !== 'rejected' ||
      spec.states.some(({id}) => !observedStateIds.has(id)) ||
      observedStateIds.size !== spec.states.length
    ) {
      throw new Error(
        'recovery-source state sheet 必须携带完整、通过且逐状态绑定的 observed key plane provenance',
      );
    }
  }
  const sourceRecovery = source.stateSheetRecoveryBinding ?? source.request?.stateSheetRecoveryBinding ?? null;
  const sourceMetadata = await sharp(input).metadata();

  await fs.mkdir(outputDirectory, {recursive: true});
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-collage-state-sheet-'));
  const python = resolvePythonCommand({root: ROOT});
  try {
    if (spec.extraction) {
      for (const state of spec.states) {
        const cell = explicitExtractionFor({spec, state});
        const observedState = stateObservationFor({
          source,
          stateId: state.id,
        });
        const keyColor =
          observedState?.observedKeyColor ?? spec.keying.keyColor;
        assertExtractionFitsSource({cell, sourceMetadata});
        await writeExplicitRegisteredCell({
          input,
          destination: path.join(temporary, `${spec.poseFamilyId}-${state.id}-registered-key.png`),
          cell,
          canvas: spec.extraction.canvas,
          keyBackground: await keyBackgroundFor({input, keyColor}),
        });
      }
    } else {
      await run(python, [
        'scripts/split_sheet.py', input, temporary, spec.poseFamilyId, String(spec.states.length),
        '--columns', String(spec.layout.columns), '--padding', '0', '--suffix', 'registered-key', '--preserve-canvas',
      ]);
    }
    for (const [index, state] of spec.states.entries()) {
      const cell = spec.extraction
        ? path.join(temporary, `${spec.poseFamilyId}-${state.id}-registered-key.png`)
        : path.join(temporary, `${spec.poseFamilyId}-${index + 1}-registered-key.png`);
      const output = path.join(outputDirectory, stateOutputName({poseFamilyId: spec.poseFamilyId, stateId: state.id}));
      const observedState = stateObservationFor({
        source,
        stateId: state.id,
      });
      const keyColor =
        observedState?.observedKeyColor ?? spec.keying.keyColor;
      await run(python, [
        'scripts/remove_chroma_key.py', '--input', cell, '--out', output,
        '--transparent-threshold', String(spec.keying.transparentThreshold),
        '--opaque-threshold', String(spec.keying.opaqueThreshold),
        '--edge-feather', String(spec.keying.edgeFeather),
        '--key-color', keyColor, '--matte-erode', String(spec.keying.matteErode),
        '--edge-padding', String(spec.keying.edgePadding),
        '--metadata', `${output}.key.json`, '--force',
      ]);
      if (observedState) {
        const metadataFile = `${output}.key.json`;
        const keyingMetadata = await readJson(metadataFile);
        await writeJson(metadataFile, {
          ...keyingMetadata,
          providerObservation: {
            stateId: state.id,
            requestedKeyColor: observedState.requestedKeyColor,
            observedKeyColor: observedState.observedKeyColor,
            policyFingerprint: observedState.policyFingerprint,
            observationFingerprint:
              source.providerObservation.observationFingerprint,
            metrics: observedState.metrics,
          },
        });
      }
      if (state.orientationTransform?.kind === 'horizontal-mirror') {
        const mirrored = path.join(
          temporary,
          `${spec.poseFamilyId}-${state.id}-horizontal-mirror.png`,
        );
        await sharp(output).flop().png().toFile(mirrored);
        await fs.copyFile(mirrored, output);
      }
    }
  } finally {
    await fs.rm(temporary, {recursive: true, force: true});
  }

  const sourceSha256 = source.sha256 ?? await sha256(input);
  const members = [];
  for (const state of spec.states) {
    const output = path.join(outputDirectory, stateOutputName({poseFamilyId: spec.poseFamilyId, stateId: state.id}));
    const stat = await fs.stat(output);
    const metadata = await sharp(output).metadata();
    members.push({stateId: state.id, sha256: await sha256(output), file: path.relative(ROOT, output), stat, metadata});
  }
  const dimensions = new Set(members.map(({metadata}) => `${metadata.width}x${metadata.height}`));
  if (dimensions.size !== 1) throw new Error(`注册状态格尺寸不一致：${[...dimensions].join(', ')}`);
  const anchorRegistrationProof = inspectStateAnchorRegistration({
    states: spec.states.map((state) => ({
      ...state,
      ...resolveOutputStateRegistration(state),
    })),
    anchorPolicy: spec.anchorPolicy,
  });
  if (!anchorRegistrationProof.passed) {
    throw new Error('逐状态 anchor registration proof 未通过');
  }
  const anchorEvidence = new Map();
  for (const member of members) {
    const state = spec.states.find(({id}) => id === member.stateId);
    const outputRegistration = resolveOutputStateRegistration(state);
    const evidenceFile = path.join(
      outputDirectory,
      `${spec.poseFamilyId}-${member.stateId}-anchors.png`,
    );
    await writeAnchorOverlay({
      input: path.resolve(ROOT, member.file),
      output: evidenceFile,
      anchors: outputRegistration.anchors,
      width: member.metadata.width,
      height: member.metadata.height,
    });
    anchorEvidence.set(member.stateId, {
      file: path.relative(ROOT, evidenceFile),
      sha256: await sha256(evidenceFile),
    });
  }
  const familyFingerprint = createStateFamilyFingerprint({sourceSha256, spec, members});
  const recordedAt = new Date().toISOString();
  const derived = members.map(({stateId, sha256: memberSha256, file, stat, metadata}) => {
    const state = spec.states.find(({id}) => id === stateId);
    const outputRegistration = resolveOutputStateRegistration(state);
    const assetId = `${spec.poseFamilyId}-${stateId}`;
    const requestFingerprint = createHash('sha256').update(`${source.requestFingerprint}:${stateId}:${familyFingerprint}`).digest('hex');
    return {
      recordId: createAssetRecordId({assetId, requestFingerprint, sha256: memberSha256, recordedAt}),
      assetId,
      capability: 'image',
      file,
      provider: 'local-derivation',
      adapter: 'registered-sheet-cell',
      tool: 'process-state-sheet',
      model: null,
      externalId: null,
      attemptId: source.attemptId ?? null,
      requestFingerprint,
      reusedFrom: spec.sourceAssetId,
      sha256: memberSha256,
      sizeBytes: stat.size,
      media: {width: metadata.width, height: metadata.height, format: metadata.format ?? null, hasAlpha: metadata.hasAlpha ?? false},
      recordedAt,
      request: {},
      compositionBinding: {
        sceneId: spec.sceneId,
        nodeId: spec.nodeId,
        pattern: 'state-sequence',
        registrationId: spec.registration.id,
        sourceMasterAssetId: spec.registration.sourceMasterAssetId,
        outputRole: 'registered-state',
        canvas: {width: metadata.width, height: metadata.height},
        derivation: {
          method: spec.extraction ? 'explicit-source-rects' : 'crop',
          parentAssetId: spec.sourceAssetId,
          sourceRect: spec.extraction
            ? explicitExtractionFor({spec, state}).sourceRect
            : null,
          placement: spec.extraction
            ? explicitExtractionFor({spec, state}).placement
            : null,
          registrationCanvas: spec.extraction?.canvas ?? null,
          orientationTransform: state.orientationTransform ?? null,
        },
      },
      stateBinding: {
        poseFamilyId: spec.poseFamilyId,
        stateId,
        registrationId: spec.registration.id,
        sourceMasterAssetId: spec.registration.sourceMasterAssetId,
        facing: outputRegistration.facing,
        anchors: outputRegistration.anchors,
        identityReferenceAssetId: identityReference.assetId,
        identityReferenceSha256: identityReference.sha256,
        anchorEvidence: anchorEvidence.get(stateId),
      },
      stateSheetBinding: null,
      stateSheetRecoveryBinding: sourceRecovery,
      sourceSheetAssetId: spec.sourceAssetId,
      semanticBinding: source.semanticBinding ?? null,
      familyFingerprint,
      lifecycle: {status: 'active', changedAt: recordedAt, reason: 'registered-sheet-cell-derived', supersededBy: null},
    };
  });
  const derivedIds = new Set(derived.map(({assetId}) => assetId));
  const replacementByAssetId = new Map(derived.map((record) => [record.assetId, record]));
  await transactAssetManifest({
    manifestFile,
    projectSlug: spec.projectSlug,
    mutate: (latestManifest) => {
      const currentSource = latestManifest.assets.find(
        ({assetId, lifecycle}) =>
          assetId === spec.sourceAssetId &&
          ['active', 'recovery-source'].includes(lifecycle?.status),
      );
      if (
        !currentSource ||
        currentSource.recordId !== source.recordId ||
        currentSource.sha256 !== sourceSha256
      ) {
        throw new Error(
          '状态表派生期间 source asset 已变化；输出未登记，请基于当前 manifest 重试。',
        );
      }
      for (const previous of latestManifest.assets.filter(({assetId, lifecycle}) =>
        derivedIds.has(assetId) && lifecycle?.status === 'active')) {
        previous.lifecycle = {
          status: 'superseded',
          changedAt: recordedAt,
          reason: 'replaced-by-new-registered-cell',
          supersededBy: replacementByAssetId.get(previous.assetId).recordId,
        };
      }
      latestManifest.assets.push(...derived);
      return latestManifest;
    },
  });
  const providerImageCalls = ['host', 'command'].includes(source.adapter) ? 1 : 0;
  const recoveryTargetCount = sourceRecovery?.targetStateIds?.length ?? derived.length;
  await writeJson(path.join(outputDirectory, `${spec.poseFamilyId}-state-sheet-report.json`), {
    schemaVersion: 4,
    projectSlug: spec.projectSlug,
    poseFamilyId: spec.poseFamilyId,
    sourceAssetId: spec.sourceAssetId,
    sourceSha256,
    familyFingerprint,
    identityReference: {
      assetId: identityReference.assetId,
      sha256: identityReference.sha256,
      file: identityReference.file,
    },
    anchorPolicy: spec.anchorPolicy,
    anchorRegistrationProof,
    providerImageCalls,
    generationMode: sourceRecovery?.mode ??
      (source.lifecycle?.status === 'recovery-source'
        ? 'rejected-output-recovery'
        : 'initial-family-sheet'),
    sourceLifecycle: source.lifecycle?.status ?? null,
    recoverySourceSheetAssetId: sourceRecovery?.sourceSheetAssetId ?? null,
    observedKeyColors: Object.fromEntries(
      spec.states
        .map((state) => [
          state.id,
          stateObservationFor({source, stateId: state.id})?.observedKeyColor,
        ])
        .filter(([, observedKeyColor]) => Boolean(observedKeyColor)),
    ),
    repairedStateIds: sourceRecovery?.targetStateIds ?? [],
    preservedContextStateCount: sourceRecovery?.mode === 'masked-sheet-edit'
      ? derived.length - recoveryTargetCount
      : 0,
    isolatedCellGenerationUsed: false,
    extraction: spec.extraction ?? {
      mode: 'equal-grid',
      canvas: {width: members[0]?.metadata.width ?? null, height: members[0]?.metadata.height ?? null},
    },
    derivedStateCount: derived.length,
    avoidedIndividualCalls: Math.max(0, (sourceRecovery ? recoveryTargetCount : derived.length) - providerImageCalls),
    members: derived.map(({assetId, file, sha256: hash, stateBinding}) => ({
      assetId,
      file,
      sha256: hash,
      stateBinding,
      anchorEvidence: stateBinding.anchorEvidence,
    })),
    createdAt: recordedAt,
  });
  console.log(`✓ 完整 sheet 上下文派生 ${derived.length} 个注册状态；独立单格生成：0 次。`);
} catch (error) {
  console.error(`assets:process-state-sheet failed: ${error.message}`);
  process.exitCode = 1;
}
