import {stableValue} from './contract-utils.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  assertAssetManifest,
  createAssetRecordId,
} from './asset-manifest-lib.mjs';

const sha256Value = (value) =>
  createHash('sha256').update(value).digest('hex');

const workspacePath = (root, input, label) => {
  const resolved = path.resolve(root, input);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label}越过工作区：${input}`);
  }
  return resolved;
};

const imageSourceRecord = (manifest, sourceSpec) =>
  [...(manifest.assets ?? [])].reverse().find(
    (record) =>
      record.assetId === sourceSpec.assetId &&
      record.capability === 'image' &&
      (sourceSpec.sourceSha256
        ? record.sha256 === sourceSpec.sourceSha256
        : record.lifecycle?.status === 'active'),
  ) ?? null;

const componentKey = ({left, top, width, height}) =>
  `${left}:${top}:${width}:${height}`;

const identifyComponents = ({
  data,
  width,
  height,
  channels,
  alphaThreshold,
  minimumComponentPixels,
}) => {
  const pixelCount = width * height;
  const seen = new Uint8Array(pixelCount);
  const components = [];
  for (let start = 0; start < pixelCount; start += 1) {
    if (seen[start] || data[start * channels + 3] < alphaThreshold) continue;
    const stack = [start];
    const pixels = [];
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;
    seen[start] = 1;
    while (stack.length > 0) {
      const pixel = stack.pop();
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      pixels.push(pixel);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      for (const next of [pixel - 1, pixel + 1, pixel - width, pixel + width]) {
        if (next < 0 || next >= pixelCount || seen[next]) continue;
        const nextX = next % width;
        const nextY = Math.floor(next / width);
        if (Math.abs(nextX - x) + Math.abs(nextY - y) !== 1) continue;
        if (data[next * channels + 3] < alphaThreshold) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (pixels.length < minimumComponentPixels) continue;
    components.push({
      left,
      top,
      width: right - left + 1,
      height: bottom - top + 1,
      pixelCount: pixels.length,
      pixels,
    });
  }
  return components.sort(
    (left, right) =>
      left.top - right.top ||
      left.left - right.left ||
      left.width - right.width ||
      left.height - right.height,
  );
};

const publicComponent = ({left, top, width, height, pixelCount}) => ({
  left,
  top,
  width,
  height,
  pixelCount,
});

export const inspectSemanticSliceOutput = async ({file, binding}) => {
  const {data, info} = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  const components = identifyComponents({
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
    alphaThreshold: binding.alphaThreshold,
    minimumComponentPixels: binding.minimumComponentPixels,
  }).map(publicComponent);
  const expectedComponents = binding.components.map(publicComponent);
  return {
    passed:
      JSON.stringify(components) === JSON.stringify(expectedComponents) &&
      components.reduce((total, component) => total + component.pixelCount, 0) ===
        binding.outputAlphaPixels,
    expectedComponents,
    actualComponents: components,
    expectedAlphaPixels: binding.outputAlphaPixels,
    actualAlphaPixels: components.reduce(
      (total, component) => total + component.pixelCount,
      0,
    ),
  };
};

export const validateSemanticSlicesSpec = (spec) => {
  const errors = [];
  if (spec?.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
  for (const field of ['projectSlug', 'sceneId', 'topologyId']) {
    if (typeof spec?.[field] !== 'string' || spec[field].trim() === '') {
      errors.push(`${field} 不能为空`);
    }
  }
  if (!Number.isInteger(spec?.alphaThreshold) || spec.alphaThreshold < 1 || spec.alphaThreshold > 254) {
    errors.push('alphaThreshold 必须是 1..254 的整数');
  }
  if (!Number.isInteger(spec?.minimumComponentPixels) || spec.minimumComponentPixels < 1) {
    errors.push('minimumComponentPixels 必须是正整数');
  }
  const assetIds = new Set();
  const nodeIds = new Set();
  const outputs = new Set();
  for (const [sourceIndex, source] of (spec?.sources ?? []).entries()) {
    if (typeof source?.assetId !== 'string' || source.assetId.trim() === '') {
      errors.push(`sources[${sourceIndex}].assetId 不能为空`);
    }
    if (
      source?.sourceSha256 !== undefined &&
      !/^[a-f0-9]{64}$/.test(source.sourceSha256)
    ) {
      errors.push(`sources[${sourceIndex}].sourceSha256 必须是 SHA-256`);
    }
    const remaining = (source?.slices ?? []).filter(
      ({components}) => components === 'remaining',
    );
    if (remaining.length !== 1) {
      errors.push(`sources[${sourceIndex}] 必须恰好有一个 components=remaining 切片`);
    }
    for (const [sliceIndex, slice] of (source?.slices ?? []).entries()) {
      const location = `sources[${sourceIndex}].slices[${sliceIndex}]`;
      if (assetIds.has(slice.assetId)) errors.push(`${location}.assetId 重复`);
      if (nodeIds.has(slice.nodeId)) errors.push(`${location}.nodeId 重复`);
      if (outputs.has(slice.output)) errors.push(`${location}.output 重复`);
      assetIds.add(slice.assetId);
      nodeIds.add(slice.nodeId);
      outputs.add(slice.output);
      if (
        slice.components !== 'remaining' &&
        (!Array.isArray(slice.components) || slice.components.length === 0)
      ) {
        errors.push(`${location}.components 必须声明组件边界或 remaining`);
      }
    }
  }
  if (!Array.isArray(spec?.sources) || spec.sources.length === 0) {
    errors.push('sources 至少需要一个来源');
  }
  return errors;
};

const deriveSourceSlices = async ({root, manifest, spec, sourceSpec}) => {
  const sourceRecord = imageSourceRecord(manifest, sourceSpec);
  if (!sourceRecord) {
    throw new Error(
      sourceSpec.sourceSha256
        ? `找不到指定 SHA-256 的 image source：${sourceSpec.assetId}/${sourceSpec.sourceSha256}`
        : `找不到 active image source：${sourceSpec.assetId}`,
    );
  }
  const sourceFile = workspacePath(root, sourceRecord.file, 'semantic slice source');
  const sourceSha256 = sha256Value(await fs.readFile(sourceFile));
  if (sourceSha256 !== sourceRecord.sha256) {
    throw new Error(`${sourceSpec.assetId} manifest SHA 已漂移`);
  }
  const {data, info} = await sharp(sourceFile)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  const components = identifyComponents({
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
    alphaThreshold: spec.alphaThreshold,
    minimumComponentPixels: spec.minimumComponentPixels,
  });
  const byKey = new Map(components.map((component) => [componentKey(component), component]));
  const assigned = new Set();
  const selections = new Map();
  for (const slice of sourceSpec.slices.filter(({components: value}) => value !== 'remaining')) {
    const selected = [];
    for (const rectangle of slice.components) {
      const key = componentKey(rectangle);
      const component = byKey.get(key);
      if (!component) {
        throw new Error(
          `${slice.assetId} 找不到声明组件 ${key}；来源 alpha 拓扑已变化`,
        );
      }
      if (assigned.has(key)) {
        throw new Error(`${slice.assetId} 重复占用组件 ${key}`);
      }
      assigned.add(key);
      selected.push(component);
    }
    selections.set(slice.assetId, selected);
  }
  const remainingSlice = sourceSpec.slices.find(
    ({components: value}) => value === 'remaining',
  );
  selections.set(
    remainingSlice.assetId,
    components.filter((component) => !assigned.has(componentKey(component))),
  );
  const sourceAlphaPixels = components.reduce(
    (total, component) => total + component.pixelCount,
    0,
  );
  const results = [];
  for (const slice of sourceSpec.slices) {
    const selected = selections.get(slice.assetId) ?? [];
    if (selected.length === 0) {
      throw new Error(`${slice.assetId} 没有获得任何 alpha 组件`);
    }
    const selectedPixels = new Uint8Array(info.width * info.height);
    for (const component of selected) {
      for (const pixel of component.pixels) selectedPixels[pixel] = 1;
    }
    const outputData = Buffer.from(data);
    for (let pixel = 0; pixel < selectedPixels.length; pixel += 1) {
      if (selectedPixels[pixel] === 0) {
        outputData[pixel * info.channels + 3] = 0;
      }
    }
    const outputBuffer = await sharp(outputData, {
      raw: {
        width: info.width,
        height: info.height,
        channels: info.channels,
      },
    })
      .png()
      .toBuffer();
    const output = workspacePath(root, slice.output, `${slice.assetId} output`);
    if (!path.relative(root, output).startsWith(`public${path.sep}`)) {
      throw new Error(`${slice.assetId} output 必须位于 public/ 内`);
    }
    await fs.mkdir(path.dirname(output), {recursive: true});
    await fs.writeFile(output, outputBuffer);
    const outputSha256 = sha256Value(outputBuffer);
    const stat = await fs.stat(output);
    const outputAlphaPixels = selected.reduce(
      (total, component) => total + component.pixelCount,
      0,
    );
    const sliceFingerprint = sha256Value(JSON.stringify(stableValue({
      schemaVersion: 1,
      topologyId: spec.topologyId,
      sourceAssetId: sourceRecord.assetId,
      sourceSha256,
      alphaThreshold: spec.alphaThreshold,
      minimumComponentPixels: spec.minimumComponentPixels,
      semanticRole: slice.semanticRole,
      components: selected.map(({left, top, width, height, pixelCount}) => ({
        left,
        top,
        width,
        height,
        pixelCount,
      })),
      outputSha256,
    })));
    results.push({
      slice,
      sourceRecord,
      sourceSha256,
      file: path.relative(root, output),
      sha256: outputSha256,
      sizeBytes: stat.size,
      media: {
        width: info.width,
        height: info.height,
        format: 'png',
        hasAlpha: true,
      },
      binding: {
        schemaVersion: 1,
        topologyId: spec.topologyId,
        sourceAssetId: sourceRecord.assetId,
        sourceSha256,
        semanticRole: slice.semanticRole,
        alphaThreshold: spec.alphaThreshold,
        minimumComponentPixels: spec.minimumComponentPixels,
        components: selected.map(publicComponent),
        sourceAlphaPixels,
        outputAlphaPixels,
        outputCanvasPreserved: true,
        boundaryCutPixels: 0,
        sliceFingerprint,
      },
    });
  }
  const assignedPixels = results.reduce(
    (total, result) => total + result.binding.outputAlphaPixels,
    0,
  );
  if (assignedPixels !== sourceAlphaPixels) {
    throw new Error(
      `${sourceSpec.assetId} 组件分配不完整：${assignedPixels}/${sourceAlphaPixels}`,
    );
  }
  return {sourceRecord, sourceSha256, sourceAlphaPixels, components, results};
};

export const deriveSemanticSlices = async ({
  root,
  spec,
  manifest,
  now = new Date().toISOString(),
}) => {
  const errors = validateSemanticSlicesSpec(spec);
  if (errors.length > 0) {
    throw new Error(`semantic slices spec 无效：${errors.join('；')}`);
  }
  assertAssetManifest(manifest, spec.projectSlug);
  const sourceResults = [];
  for (const sourceSpec of spec.sources) {
    sourceResults.push(
      await deriveSourceSlices({root, manifest, spec, sourceSpec}),
    );
  }
  const derived = sourceResults.flatMap(({results}) => results);
  const records = derived.map((result) => {
    const requestFingerprint = result.binding.sliceFingerprint;
    return {
      recordId: createAssetRecordId({
        assetId: result.slice.assetId,
        requestFingerprint,
        sha256: result.sha256,
        recordedAt: now,
      }),
      assetId: result.slice.assetId,
      capability: 'image',
      file: result.file,
      provider: 'local-derivation',
      adapter: 'semantic-slice-derivative',
      tool: 'derive-semantic-slices',
      model: null,
      externalId: null,
      attemptId: null,
      recoveredFromClosedAttempt: false,
      recoveredFromRejectedAttempt: false,
      requestFingerprint,
      reusedFrom: result.sourceRecord.assetId,
      sha256: result.sha256,
      sizeBytes: result.sizeBytes,
      media: result.media,
      recordedAt: now,
      request: {},
      compositionBinding: {
        sceneId: spec.sceneId,
        nodeId: result.slice.nodeId,
        pattern: 'free',
        registrationId:
          result.sourceRecord.registeredFamilyBinding?.registrationId ?? null,
        sourceMasterAssetId:
          result.sourceRecord.registeredFamilyBinding?.sourceMasterAssetId ?? null,
        outputRole: result.slice.semanticRole,
        canvas: {
          width: result.media.width,
          height: result.media.height,
        },
        derivation: {
          method: 'alpha-component-slice',
          parentAssetId: result.sourceRecord.assetId,
        },
      },
      stateBinding: null,
      stateSheetBinding: null,
      stateSheetRecoveryBinding: null,
      sourceSheetAssetId:
        result.sourceRecord.sourceSheetAssetId ??
        result.sourceRecord.registeredFamilyBinding?.source?.sourceSheetAssetId ??
        null,
      registeredFamilyBinding: null,
      containerPackageBinding: null,
      canonicalContainerBinding: null,
      loopingStripBinding: null,
      semanticSliceBinding: result.binding,
      semanticBinding:
        result.sourceRecord.semanticBinding ??
        result.sourceRecord.request?.semanticBinding ??
        null,
      providerObservation: null,
      familyFingerprint: null,
      lifecycle: {
        status: 'active',
        changedAt: now,
        reason: 'semantic-alpha-component-local-derivative',
        supersededBy: null,
      },
    };
  });
  const replacementById = new Map(records.map((record) => [record.assetId, record]));
  for (const previous of manifest.assets.filter(
    ({assetId, lifecycle}) =>
      replacementById.has(assetId) && lifecycle?.status === 'active',
  )) {
    previous.lifecycle = {
      status: 'superseded',
      changedAt: now,
      reason: 'replaced-by-new-semantic-slice-derivative',
      supersededBy: replacementById.get(previous.assetId).recordId,
    };
  }
  manifest.assets.push(...records);
  assertAssetManifest(manifest, spec.projectSlug);
  return {
    manifest,
    records,
    report: {
      schemaVersion: 1,
      projectSlug: spec.projectSlug,
      sceneId: spec.sceneId,
      topologyId: spec.topologyId,
      alphaThreshold: spec.alphaThreshold,
      minimumComponentPixels: spec.minimumComponentPixels,
      providerImageCalls: 0,
      localDerivatives: records.length,
      sources: sourceResults.map((source) => ({
        assetId: source.sourceRecord.assetId,
        sha256: source.sourceSha256,
        sourceAlphaPixels: source.sourceAlphaPixels,
        componentCount: source.components.length,
        assignedAlphaPixels: source.results.reduce(
          (total, result) => total + result.binding.outputAlphaPixels,
          0,
        ),
      })),
      slices: records.map((record) => ({
        assetId: record.assetId,
        file: record.file,
        semanticRole: record.semanticSliceBinding.semanticRole,
        sourceAssetId: record.semanticSliceBinding.sourceAssetId,
        outputAlphaPixels: record.semanticSliceBinding.outputAlphaPixels,
        components: record.semanticSliceBinding.components,
        sha256: record.sha256,
        sliceFingerprint: record.semanticSliceBinding.sliceFingerprint,
      })),
      createdAt: now,
    },
  };
};
