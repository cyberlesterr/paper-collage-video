import {stableValue} from './contract-utils.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
export const STYLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const styleProfileBinding = (styleProfile) => {
  const generation = styleProfile?.generation ?? {};
  return {
    schemaVersion: 1,
    id: styleProfile?.id,
    catalogVersion: styleProfile?.catalogVersion,
    profileFingerprint: styleProfile?.profileFingerprint,
    directives: [
      ...(generation.promptDirectives ?? []),
      ...(generation.negativeDirectives ?? []).map(
        (directive) => `Avoid: ${directive}`,
      ),
      ...(generation.compositionPrinciples ?? []).map(
        (directive) => `Composition: ${directive}`,
      ),
    ],
  };
};

export const validateStyleProfileBinding = (binding) => {
  const issues = [];
  const add = (message, location) => issues.push({message, location});
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return [{message: '缺少 styleProfileBinding。', location: 'styleProfileBinding'}];
  }
  if (binding.schemaVersion !== 1) {
    add('styleProfileBinding.schemaVersion 必须为 1。', 'styleProfileBinding.schemaVersion');
  }
  if (!STYLE_ID_PATTERN.test(binding.id ?? '')) {
    add('styleProfileBinding.id 必须是有效的目录风格 id。', 'styleProfileBinding.id');
  }
  if (typeof binding.catalogVersion !== 'string' || !binding.catalogVersion) {
    add('styleProfileBinding.catalogVersion 不能为空。', 'styleProfileBinding.catalogVersion');
  }
  if (!FINGERPRINT_PATTERN.test(binding.profileFingerprint ?? '')) {
    add('styleProfileBinding.profileFingerprint 无效。', 'styleProfileBinding.profileFingerprint');
  }
  if (
    !Array.isArray(binding.directives) ||
    binding.directives.length < 3 ||
    new Set(binding.directives).size !== binding.directives.length ||
    binding.directives.some(
      (directive) => typeof directive !== 'string' || !directive.trim(),
    )
  ) {
    add('styleProfileBinding.directives 必须包含至少三条不重复指令。', 'styleProfileBinding.directives');
  }
  return issues;
};

export const validateStyleProfileSnapshot = (profile) => {
  const issues = [];
  const add = (message, location) => issues.push({message, location});
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return [{message: '缺少已冻结的 styleProfile。', location: 'styleProfile'}];
  }
  if (profile.schemaVersion !== 2) {
    add('styleProfile.schemaVersion 必须为 2。', 'styleProfile.schemaVersion');
  }
  if (!STYLE_ID_PATTERN.test(profile.id ?? '')) {
    add('styleProfile.id 必须是有效的目录风格 id。', 'styleProfile.id');
  }
  for (const [key, value] of [
    ['label', profile.label],
    ['summary', profile.summary],
    ['catalogVersion', profile.catalogVersion],
    ['referenceImage', profile.referenceImage],
  ]) {
    if (typeof value !== 'string' || !value.trim()) {
      add(`styleProfile.${key} 不能为空。`, `styleProfile.${key}`);
    }
  }
  for (const key of ['catalogFingerprint', 'profileFingerprint']) {
    if (!FINGERPRINT_PATTERN.test(profile[key] ?? '')) {
      add(`styleProfile.${key} 无效。`, `styleProfile.${key}`);
    }
  }
  const bindingIssues = validateStyleProfileBinding(
    profile.generation
      ? styleProfileBinding(profile)
      : null,
  );
  for (const issue of bindingIssues) {
    add(issue.message, issue.location.replace('styleProfileBinding', 'styleProfile'));
  }
  const theme = profile.render?.theme;
  const surface = theme?.surface;
  const edge = surface?.subjectEdge;
  const shadow = surface?.subjectShadow;
  if (
    !theme ||
    typeof theme !== 'object' ||
    !/^#[0-9a-f]{6}$/i.test(theme.canvas ?? '') ||
    !surface ||
    !['none', 'paper-outline'].includes(edge?.mode) ||
    !['none', 'drop-shadow'].includes(shadow?.mode) ||
    (edge.mode === 'paper-outline' &&
      (!Number.isFinite(edge.widthPx) || typeof edge.color !== 'string')) ||
    (shadow.mode === 'drop-shadow' &&
      (!Number.isFinite(shadow.offsetXPx) ||
        !Number.isFinite(shadow.offsetYPx) ||
        !Number.isFinite(shadow.blurPx) ||
        typeof shadow.color !== 'string')) ||
    (surface.texture !== null &&
      (typeof surface.texture?.src !== 'string' ||
        !surface.texture.src ||
        !Number.isFinite(surface.texture.opacity) ||
        !['normal', 'multiply', 'screen', 'overlay'].includes(
          surface.texture.blendMode,
        )))
  ) {
    add('styleProfile.render.theme.surface 契约不完整。', 'styleProfile.render.theme.surface');
  }
  const visualSfx = profile.motion?.visualSfx;
  if (
    !['paper-story', 'clean-video'].includes(profile.motion?.transitionSet) ||
    !['rare', 'selective', 'expressive'].includes(visualSfx?.policy) ||
    !Number.isInteger(visualSfx?.maxPerScene) ||
    visualSfx.maxPerScene < 0 ||
    visualSfx.maxPerScene > 3 ||
    !Array.isArray(visualSfx?.allowedKinds) ||
    visualSfx.allowedKinds.some((kind) => !['impact', 'motion'].includes(kind)) ||
    !Array.isArray(visualSfx?.durationRangeSeconds) ||
    visualSfx.durationRangeSeconds.length !== 2 ||
    visualSfx.durationRangeSeconds.some(
      (duration) => !Number.isFinite(duration) || duration < 0.1 || duration > 1,
    ) ||
    visualSfx.durationRangeSeconds[0] > visualSfx.durationRangeSeconds[1]
  ) {
    add('styleProfile.motion 的 transitionSet 或 visualSfx 契约无效。', 'styleProfile.motion');
  }
  if (
    !Array.isArray(profile.quality?.requiredAssetChecks) ||
    !profile.quality.requiredAssetChecks.includes('style-profile-conformant') ||
    !Array.isArray(profile.quality?.requiredCompositeChecks) ||
    !profile.quality.requiredCompositeChecks.includes('style-profile-consistent')
  ) {
    add('styleProfile.quality 必须启用风格 Profile 资产与合成检查。', 'styleProfile.quality');
  }
  return issues;
};

export const loadStyleCatalog = async ({root = DEFAULT_ROOT} = {}) => {
  const resolvedRoot = path.resolve(root);
  const catalogFile = path.join(
    resolvedRoot,
    'public',
    'style-catalog',
    'catalog.json',
  );
  const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
  if (catalog.schemaVersion !== 3) {
    throw new Error('style catalog schemaVersion 必须为 3。');
  }
  if (!Array.isArray(catalog.styles) || catalog.styles.length < 1) {
    throw new Error('style catalog 必须至少包含一个正式视觉风格。');
  }
  const ids = catalog.styles.map(({id}) => id);
  if (
    ids.some((id) => !STYLE_ID_PATTERN.test(id ?? '')) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error('style catalog 的风格 id 必须有效且唯一。');
  }
  const images = {};
  for (const style of catalog.styles) {
    const absolutePath = path.join(resolvedRoot, 'public', style.image);
    const source = await fs.readFile(absolutePath);
    const imageSha256 = sha256(source);
    images[style.image] = imageSha256;
    if (style.profile?.schemaVersion !== 2) {
      throw new Error(`${style.id} 缺少 executable style profile v2。`);
    }
    style.profileFingerprint = sha256(
      JSON.stringify(
        stableValue({
          id: style.id,
          label: style.label,
          summary: style.summary,
          image: style.image,
          imageSha256,
          profile: style.profile,
        }),
      ),
    );
    style.absolutePath = absolutePath;
  }
  const fingerprint = sha256(
    JSON.stringify({
      schemaVersion: catalog.schemaVersion,
      version: catalog.version,
      canonicalSubject: catalog.canonicalSubject,
      styles: catalog.styles.map(({absolutePath, ...style}) => style),
      images,
    }),
  );
  return {
    ...catalog,
    fingerprint,
    catalogFile,
    root: resolvedRoot,
    images,
  };
};

export const styleCatalogDecision = (
  catalog,
  {presentationCatalog = catalog} = {},
) => {
  if (presentationCatalog.fingerprint !== catalog.fingerprint) {
    throw new Error(
      '展示风格目录与工作区风格目录的完整指纹不一致；拒绝展示可能过期或错误的风格卡。',
    );
  }
  const presentationStyles = new Map(
    presentationCatalog.styles.map((style) => [style.id, style]),
  );
  return {
    version: catalog.version,
    fingerprint: catalog.fingerprint,
    presentationFingerprint: presentationCatalog.fingerprint,
    styles: catalog.styles.map(({
      id,
      label,
      summary,
      image,
      absolutePath,
      profileFingerprint,
      profile,
    }) => {
      const presentationStyle = presentationStyles.get(id);
      if (!presentationStyle || presentationStyle.image !== image) {
        throw new Error(
          `展示风格目录缺少与工作区一致的风格卡：${id}。`,
        );
      }
      const imageSha256 = catalog.images?.[image];
      if (!FINGERPRINT_PATTERN.test(imageSha256 ?? '')) {
        throw new Error(`工作区风格卡缺少内容指纹：${id}。`);
      }
      return {
        id,
        label,
        summary,
        image,
        imageSha256,
        runtimePath: absolutePath,
        presentationPath: presentationStyle.absolutePath,
        profileFingerprint,
        productionSummary: {
          promptDirectives: profile.generation.promptDirectives,
          compositionPrinciples: profile.generation.compositionPrinciples,
          pacing: profile.motion.pacing,
          requiredChecks: [
            ...profile.quality.requiredAssetChecks,
            ...profile.quality.requiredCompositeChecks,
          ],
        },
      };
    }),
  };
};

export const materializeStyleProfile = (catalog, styleId) => {
  const style = catalog.styles.find(({id}) => id === styleId);
  if (!style) throw new Error(`未知视觉风格：${styleId}。`);
  const snapshot = {
    schemaVersion: 2,
    id: style.id,
    label: style.label,
    summary: style.summary,
    catalogVersion: catalog.version,
    catalogFingerprint: catalog.fingerprint,
    profileFingerprint: style.profileFingerprint,
    referenceImage: style.image,
    ...structuredClone(style.profile),
  };
  const issues = validateStyleProfileSnapshot(snapshot);
  if (issues.length > 0) {
    throw new Error(
      issues.map(({location, message}) => `${location}: ${message}`).join('\n'),
    );
  }
  return snapshot;
};

export const assertStyleProfileCurrent = ({styleProfile, catalog}) => {
  const expected = materializeStyleProfile(catalog, styleProfile?.id);
  if (
    JSON.stringify(stableValue(styleProfile)) !==
    JSON.stringify(stableValue(expected))
  ) {
    throw new Error('styleProfile 与当前内置风格目录不一致；请重新执行 intake。');
  }
  return expected;
};
