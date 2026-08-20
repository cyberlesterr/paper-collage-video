#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  createAssetRecordId,
  transactAssetManifest,
} from './asset-manifest-lib.mjs';
import {ROOT, readJson} from './project-lib.mjs';

const USAGE =
  '用法：normalize-provider-source.mjs <provider-source-normalization.json>';
printCliHelp(process.argv.slice(2), USAGE);

const inside = (input, label) => {
  const resolved = path.resolve(ROOT, input);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error(`${label}越过工作区：${input}`);
  }
  return resolved;
};

const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');

try {
  const argumentsList = process.argv.slice(2);
  const specInput =
    argumentsList.find((argument) => argument.startsWith('--spec='))?.slice(7) ??
    argumentsList.find((argument) => !argument.startsWith('--'));
  if (!specInput) {
    throw new Error(
      USAGE,
    );
  }
  const spec = await readJson(inside(specInput, 'normalization spec'));
  if (
    spec.schemaVersion !== 1 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spec.projectSlug ?? '') ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spec.assetId ?? '') ||
    !spec.sourceAssetId ||
    !spec.output ||
    spec.kernel !== 'lanczos3'
  ) {
    throw new Error('provider source normalization spec 无效。');
  }
  const manifestFile = path.join(
    ROOT,
    'projects',
    spec.projectSlug,
    'assets-manifest.json',
  );
  const outputFile = inside(spec.output, 'normalization output');
  const result = await transactAssetManifest({
    manifestFile,
    projectSlug: spec.projectSlug,
    mutate: async (manifest) => {
      const source = manifest.assets.find(
        ({assetId, lifecycle}) =>
          assetId === spec.sourceAssetId &&
          ['active', 'recovery-source'].includes(lifecycle?.status),
      );
      const policy = source?.providerSource;
      if (
        !source ||
        policy?.mode !== 'provider-native' ||
        policy.normalization !== 'deterministic-resize'
      ) {
        throw new Error(
          'sourceAssetId 必须指向带 provider-native normalization provenance 的当前图片。',
        );
      }
      const sourceFile = inside(source.file, 'provider source');
      const sourceBytes = await fs.readFile(sourceFile);
      if (sha256(sourceBytes) !== source.sha256) {
        throw new Error('provider source SHA 已变化，拒绝派生。');
      }
      await fs.mkdir(path.dirname(outputFile), {recursive: true});
      await sharp(sourceBytes)
        .resize({
          width: policy.targetCanvas.width,
          height: policy.targetCanvas.height,
          fit: 'fill',
          kernel: sharp.kernel.lanczos3,
        })
        .png()
        .toFile(outputFile);
      const outputBytes = await fs.readFile(outputFile);
      const outputSha256 = sha256(outputBytes);
      const metadata = await sharp(outputBytes).metadata();
      const recordedAt = new Date().toISOString();
      const derivationFingerprint = sha256(JSON.stringify({
        schemaVersion: 1,
        sourceRecordId: source.recordId,
        sourceSha256: source.sha256,
        rawCanvas: policy.rawCanvas,
        targetCanvas: policy.targetCanvas,
        kernel: spec.kernel,
      }));
      const record = {
        recordId: createAssetRecordId({
          assetId: spec.assetId,
          requestFingerprint: derivationFingerprint,
          sha256: outputSha256,
          recordedAt,
        }),
        assetId: spec.assetId,
        capability: 'image',
        file: path.relative(ROOT, outputFile),
        provider: source.provider,
        adapter: 'provider-source-derivative',
        tool: null,
        model: source.model ?? null,
        externalId: null,
        attemptId: null,
        recoveredFromClosedAttempt: false,
        recoveredFromRejectedAttempt: false,
        requestFingerprint: derivationFingerprint,
        reusedFrom: source.recordId,
        sha256: outputSha256,
        sizeBytes: outputBytes.length,
        media: {
          width: metadata.width,
          height: metadata.height,
          format: metadata.format ?? 'png',
          hasAlpha: Boolean(metadata.hasAlpha),
        },
        recordedAt,
        request: {
          capability: 'image',
          derivation: 'provider-source-normalization',
          sourceAssetId: spec.sourceAssetId,
          sourceSha256: source.sha256,
          rawCanvas: policy.rawCanvas,
          targetCanvas: policy.targetCanvas,
          kernel: spec.kernel,
        },
        providerSource: null,
        compositionBinding: {
          ...(source.compositionBinding ?? {}),
          canvas: policy.targetCanvas,
          derivation: {
            method: 'deterministic-resize',
            parentAssetId: spec.sourceAssetId,
          },
        },
        stateBinding: source.stateBinding ?? null,
        stateSheetBinding: source.stateSheetBinding ?? null,
        stateSheetRecoveryBinding: null,
        containerPackageBinding: source.containerPackageBinding ?? null,
        semanticBinding: source.semanticBinding ?? null,
        providerObservation: null,
        familyFingerprint: derivationFingerprint,
        lifecycle: {
          status: 'active',
          changedAt: recordedAt,
          reason: 'provider-native source normalized deterministically',
          supersededBy: null,
        },
      };
      for (const previous of manifest.assets.filter(
        ({assetId, lifecycle}) =>
          assetId === spec.assetId && lifecycle?.status === 'active',
      )) {
        previous.lifecycle = {
          status: 'superseded',
          changedAt: recordedAt,
          reason: 'replaced by current provider source normalization',
          supersededBy: record.recordId,
        };
      }
      manifest.assets.push(record);
      return {manifest, record, providerImageCalls: 0};
    },
  });
  console.log(
    `✓ provider source normalized: ${result.record.file} · provider image calls 0。`,
  );
} catch (error) {
  console.error(`assets:normalize-provider-source failed: ${error.message}`);
  process.exitCode = 1;
}
