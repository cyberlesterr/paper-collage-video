import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  ROOT,
  fileExists,
  loadProject,
  projectPaths,
  readJson,
  resolvePublicFile,
  writeJson,
} from './project-lib.mjs';
import {validateCompositionStructure} from './composition-lib.mjs';
import {validateDirectingExecution} from './motion-treatment-lib.mjs';
import {createRuntimeBuildFingerprint} from './runtime-build-lib.mjs';
import {loadStoryboard} from './storyboard-lib.mjs';
import {
  assertOperationCircuitClosed,
  recordOperationSuccess,
} from './failure-circuit-lib.mjs';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const OMITTED_VISUAL_KEYS = new Set([
  'adapter',
  'derivationFingerprint',
  'familyFingerprint',
  'file',
  'identityReferenceSha256',
  'keyingMetadataSha256',
  'maskSha256',
  'observationFingerprint',
  'observationPolicyFingerprint',
  'outputSha256',
  'provider',
  'recordId',
  'sha256',
  'sourceFamilyFingerprint',
  'src',
  'timingSrc',
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

const hashFile = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

const xmlEscape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const normalizedVisualValue = (value, key = null) => {
  if (key && (OMITTED_VISUAL_KEYS.has(key) || key.endsWith('Sha256'))) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizedVisualValue(entry))
      .filter((entry) => entry !== undefined);
  }
  if (value === null || typeof value !== 'object') return value;
  const normalized = {};
  for (const childKey of Object.keys(value).sort()) {
    const child = normalizedVisualValue(value[childKey], childKey);
    if (child !== undefined) normalized[childKey] = child;
  }
  return normalized;
};

const sceneDurationSeconds = (scene) =>
  Number(scene.narration?.startSeconds ?? 0) +
  Number(scene.narration?.durationSeconds ?? 0) +
  Number(scene.tailSeconds ?? 0);

const visualSceneContract = (scene) => ({
  id: scene.id,
  label: scene.label,
  eyebrow: scene.eyebrow,
  durationSeconds: sceneDurationSeconds(scene),
  appearance: normalizedVisualValue(scene.appearance ?? null),
  motion: normalizedVisualValue(scene.motion),
  composition: normalizedVisualValue(scene.composition),
  camera: normalizedVisualValue(scene.camera),
  narration: {
    startSeconds: Number(scene.narration?.startSeconds ?? 0),
    text: String(scene.narration?.text ?? ''),
  },
  encounters: normalizedVisualValue(scene.encounters ?? []),
  events: (scene.events ?? []).map(({sound, ...event}) =>
    normalizedVisualValue(event),
  ),
});

export const createVisualBlueprintContract = (project) => ({
  schemaVersion: 1,
  projectSlug: project.slug,
  intake: {
    aspectRatio: project.intake?.aspectRatio ?? null,
    visualStylePreset: project.intake?.visualStylePreset ?? null,
    parallaxPreference: project.intake?.parallaxPreference ?? null,
    styleProfileFingerprint:
      project.intake?.styleProfileFingerprint ?? null,
  },
  style: {
    id: project.styleProfile?.id ?? null,
    profileFingerprint: project.styleProfile?.profileFingerprint ?? null,
    theme: normalizedVisualValue(project.theme),
  },
  video: normalizedVisualValue(project.video),
  motionContract: normalizedVisualValue(project.motionContract),
  editorial: normalizedVisualValue(project.editorial),
  spatialContracts: normalizedVisualValue(project.spatialContracts ?? []),
  worlds: normalizedVisualValue(project.worlds ?? []),
  trajectoryContracts: normalizedVisualValue(
    project.trajectoryContracts ?? [],
  ),
  sceneTransitions: normalizedVisualValue(project.sceneTransitions ?? []),
  scenes: (project.scenes ?? []).map(visualSceneContract),
});

export const visualBlueprintFingerprint = (project) =>
  hashValue(createVisualBlueprintContract(project));

export const visualBlueprintReviewOperation = 'visual-blueprint-review';

export const visualBlueprintPaths = (slug) => {
  const paths = projectPaths(slug);
  const directory = path.join(paths.distDirectory, 'visual-blueprint');
  return {
    directory,
    report: path.join(directory, 'index.json'),
    animatic: path.join(directory, 'animatic.mp4'),
    contactSheet: path.join(directory, 'scene-keyframes.jpg'),
    styleFrame: path.join(directory, 'style-frame.jpg'),
    props: path.join(directory, 'visual-blueprint.project.json'),
    keyframes: path.join(directory, 'keyframes'),
    clips: path.join(directory, 'motion-clips'),
    approval: path.join(
      paths.projectDirectory,
      'visual-blueprint-approval.json',
    ),
    proxyDirectory: path.join(
      paths.publicDirectory,
      'visual-blueprint-proxies',
    ),
  };
};

const flattenNodes = (nodes = []) =>
  nodes.flatMap((node) => [
    node,
    ...(node.kind === 'group'
      ? flattenNodes(node.children)
      : node.kind === 'editorial-switch'
        ? node.panels.flatMap(({node: panelNode}) =>
            flattenNodes([panelNode]),
          )
        : []),
  ]);

const nodeCarriesMotion = (node) =>
  node.kind === 'state-sequence' ||
  node.kind === 'motif-field' ||
  node.kind === 'world-strip' ||
  node.motion?.path ||
  (node.motion?.keyframes ?? []).some(
    ({
      offsetX = 0,
      offsetY = 0,
      scale = 1,
      rotation = 0,
      opacity = 1,
    }) =>
      offsetX !== 0 ||
      offsetY !== 0 ||
      scale !== 1 ||
      rotation !== 0 ||
      opacity !== 1,
  ) ||
  (node.motion?.idle && node.motion.idle.preset !== 'still');

export const sceneNeedsMotionClip = (scene) =>
  scene.motion?.blueprint !== 'quiet-lockup' &&
  (
    scene.camera?.preset !== 'static' ||
    (scene.camera?.keyframes?.length ?? 0) >= 2 ||
    flattenNodes(scene.composition?.nodes).some(nodeCarriesMotion) ||
    (scene.events ?? []).some(({visual}) => visual && visual.kind !== 'hold')
  );

export const validateVisualBlueprintExecution = ({project, storyboard}) => {
  const issues = [];
  const storyboardById = new Map(
    (storyboard.scenes ?? []).map((scene) => [scene.id, scene]),
  );
  if ((project.scenes ?? []).length !== storyboardById.size) {
    issues.push({
      code: 'visual-blueprint-scene-count',
      location: 'scenes',
      message:
        `视觉蓝图必须覆盖故事板全部 ${storyboardById.size} 幕，当前为 ${project.scenes?.length ?? 0} 幕。`,
    });
  }
  for (const [index, scene] of (project.scenes ?? []).entries()) {
    const storyboardScene = storyboardById.get(scene.id);
    if (!storyboardScene) {
      issues.push({
        code: 'visual-blueprint-scene-id',
        location: `scenes[${index}].id`,
        message: `镜头 ${scene.id} 不在已批准故事板中。`,
      });
      continue;
    }
    const durationSeconds = sceneDurationSeconds(scene);
    if (!(durationSeconds > 0)) {
      issues.push({
        code: 'visual-blueprint-scene-duration',
        location: `scenes[${index}]`,
        message: `镜头 ${scene.id} 缺少可播放时长。`,
      });
    }
    const structure = validateCompositionStructure({
      composition: scene.composition,
      video: project.video,
      proofTimes: scene.motion?.proofTimes ?? [],
      durationSeconds,
      location: `scenes[${index}].composition`,
      editorial: project.editorial,
      sceneId: scene.id,
    });
    issues.push(
      ...structure.issues
        .filter(({level}) => level === 'error')
        .map(({level, ...issue}) => issue),
    );
    issues.push(
      ...validateDirectingExecution({
        scene,
        storyboardScene,
        location: `scenes[${index}]`,
      }),
    );
    if (
      JSON.stringify(scene.motion?.proofTimes ?? []) !==
      JSON.stringify(storyboardScene.proofTimes ?? [])
    ) {
      issues.push({
        code: 'visual-blueprint-proof-drift',
        location: `scenes[${index}].motion.proofTimes`,
        message: `镜头 ${scene.id} 的开始/动作/结尾证明时刻必须与故事板一致。`,
      });
    }
  }
  if (
    JSON.stringify(project.sceneTransitions ?? []) !==
    JSON.stringify(storyboard.sceneTransitions ?? [])
  ) {
    issues.push({
      code: 'visual-blueprint-transition-drift',
      location: 'sceneTransitions',
      message: '视觉蓝图的转场必须与故事板一致。',
    });
  }
  return issues;
};

const deterministicColor = (id, fallback) => {
  const digest = createHash('sha256').update(id).digest();
  const channel = (index) => 70 + (digest[index] % 130);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})` || fallback;
};

const proxySvg = ({
  id,
  role,
  width,
  height,
  facing = 'neutral',
  opaque = false,
  theme,
}) => {
  const safeId = xmlEscape(id);
  const safeRole = xmlEscape(role);
  const background = opaque
    ? theme?.sceneBackground ?? theme?.canvas ?? '#e8ddca'
    : 'none';
  const color = deterministicColor(`${id}:${role}`, theme?.accent);
  const arrow =
    facing === 'left'
      ? '←'
      : facing === 'right'
        ? '→'
        : facing === 'front'
          ? '↟'
          : facing === 'back'
            ? '↡'
            : '•';
  const isWideSurface = ['background', 'environment', 'world-strip'].includes(
    role,
  );
  const repeat = isWideSurface
    ? Array.from({length: 7}, (_, index) => {
        const x = (index / 6) * width;
        return `<path d="M ${x - width * 0.08} ${height * 0.74} Q ${x} ${height * 0.38} ${x + width * 0.08} ${height * 0.74}" fill="none" stroke="${color}" stroke-width="${Math.max(3, height * 0.015)}" opacity=".52"/>`;
      }).join('')
    : '';
  const subject = isWideSurface
    ? ''
    : `<ellipse cx="${width * 0.5}" cy="${height * 0.35}" rx="${width * 0.16}" ry="${height * 0.16}" fill="${color}"/>
       <path d="M ${width * 0.32} ${height * 0.78} Q ${width * 0.5} ${height * 0.36} ${width * 0.68} ${height * 0.78} Z" fill="${color}" opacity=".9"/>
       <text x="${width * 0.5}" y="${height * 0.58}" text-anchor="middle" font-size="${Math.max(24, Math.min(width, height) * 0.13)}" fill="white">${arrow}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${background}"/>
    <rect x="${width * 0.015}" y="${height * 0.02}" width="${width * 0.97}" height="${height * 0.96}" rx="${Math.max(8, Math.min(width, height) * 0.035)}" fill="${opaque ? color : 'none'}" fill-opacity="${opaque ? '.16' : '0'}" stroke="${color}" stroke-width="${Math.max(3, Math.min(width, height) * 0.015)}" stroke-dasharray="${Math.max(8, Math.min(width, height) * 0.05)} ${Math.max(5, Math.min(width, height) * 0.025)}"/>
    ${repeat}
    ${subject}
    <rect x="${width * 0.04}" y="${height * 0.055}" width="${width * 0.58}" height="${height * 0.16}" rx="${Math.max(6, height * 0.025)}" fill="${theme?.canvas ?? '#fff8ea'}" fill-opacity=".88"/>
    <text x="${width * 0.065}" y="${height * 0.13}" font-family="Arial, sans-serif" font-size="${Math.max(16, Math.min(width, height) * 0.06)}" font-weight="700" fill="${theme?.ink ?? '#33251d'}">${safeRole}</text>
    <text x="${width * 0.065}" y="${height * 0.19}" font-family="Arial, sans-serif" font-size="${Math.max(13, Math.min(width, height) * 0.04)}" fill="${theme?.ink ?? '#33251d'}">${safeId}</text>
  </svg>`;
};

const safeProxyName = (value) =>
  `${createHash('sha256').update(value).digest('hex').slice(0, 18)}.svg`;

const writeProxy = async ({
  paths,
  id,
  role,
  width,
  height,
  facing,
  opaque,
  theme,
}) => {
  const filename = safeProxyName(`${id}:${role}:${facing}:${width}:${height}`);
  const file = path.join(paths.proxyDirectory, filename);
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(
    file,
    proxySvg({id, role, width, height, facing, opaque, theme}),
    'utf8',
  );
  return path
    .relative(path.join(ROOT, 'public'), file)
    .split(path.sep)
    .join('/');
};

const sourceIsCurrent = async (src) => {
  if (typeof src !== 'string' || src.trim().length === 0) return false;
  try {
    return await fileExists(resolvePublicFile(src));
  } catch {
    return false;
  }
};

const ensureSilentWav = async (paths) => {
  const file = path.join(paths.proxyDirectory, 'silence.wav');
  if (await fileExists(file)) {
    return path
      .relative(path.join(ROOT, 'public'), file)
      .split(path.sep)
      .join('/');
  }
  const sampleRate = 48000;
  const seconds = 1;
  const sampleCount = sampleRate * seconds;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, buffer);
  return path
    .relative(path.join(ROOT, 'public'), file)
    .split(path.sep)
    .join('/');
};

const materializeNodeSources = async ({
  node,
  project,
  paths,
  coverage,
}) => {
  const clone = structuredClone(node);
  if (clone.kind === 'asset' || clone.kind === 'world-strip') {
    if (await sourceIsCurrent(clone.src)) {
      coverage.actual += 1;
    } else {
      const output = clone.loopingStripBinding?.output;
      const width =
        clone.kind === 'world-strip'
          ? output?.width ?? Math.max(2048, project.video.width * 2)
          : project.video.width;
      const height =
        clone.kind === 'world-strip'
          ? output?.height ?? Math.max(360, Math.round(project.video.height * 0.7))
          : project.video.height;
      clone.src = await writeProxy({
        paths,
        id: clone.id,
        role: clone.kind === 'world-strip' ? 'world-strip' : clone.assetRole,
        width,
        height,
        facing: 'neutral',
        opaque:
          clone.kind === 'world-strip' ||
          ['background', 'environment'].includes(clone.assetRole),
        theme: project.theme,
      });
      coverage.proxy += 1;
    }
  }
  if (clone.kind === 'state-sequence') {
    for (const state of clone.states ?? []) {
      if (await sourceIsCurrent(state.src)) {
        coverage.actual += 1;
      } else {
        state.src = await writeProxy({
          paths,
          id: `${clone.id}:${state.id}`,
          role: clone.assetRole,
          width: clone.registration?.canvas?.width ?? project.video.width,
          height: clone.registration?.canvas?.height ?? project.video.height,
          facing: state.facing,
          opaque: false,
          theme: project.theme,
        });
        coverage.proxy += 1;
      }
    }
  }
  if (clone.kind === 'motif-field') {
    for (const motif of clone.motifs ?? []) {
      if (await sourceIsCurrent(motif.src)) {
        coverage.actual += 1;
      } else {
        motif.src = await writeProxy({
          paths,
          id: `${clone.id}:${motif.id}`,
          role: 'decorative',
          width: 256,
          height: 256,
          facing: 'neutral',
          opaque: false,
          theme: project.theme,
        });
        coverage.proxy += 1;
      }
    }
  }
  if (clone.kind === 'group') {
    clone.children = await Promise.all(
      (clone.children ?? []).map((child) =>
        materializeNodeSources({node: child, project, paths, coverage}),
      ),
    );
  }
  if (clone.kind === 'editorial-switch') {
    clone.panels = await Promise.all(
      (clone.panels ?? []).map(async (panel) => ({
        ...panel,
        node: await materializeNodeSources({
          node: panel.node,
          project,
          paths,
          coverage,
        }),
      })),
    );
  }
  return clone;
};

export const materializeVisualBlueprintProject = async (project) => {
  const paths = visualBlueprintPaths(project.slug);
  const coverage = {actual: 0, proxy: 0};
  const silence = await ensureSilentWav(paths);
  const clone = structuredClone(project);
  clone.audio = {...clone.audio, music: null};
  if (
    clone.theme?.surface?.texture?.src &&
    !(await sourceIsCurrent(clone.theme.surface.texture.src))
  ) {
    delete clone.theme.surface.texture;
  }
  if (clone.theme?.fontFile && !(await sourceIsCurrent(clone.theme.fontFile))) {
    delete clone.theme.fontFile;
  }
  clone.scenes = await Promise.all(
    (clone.scenes ?? []).map(async (scene) => ({
      ...scene,
      narration: {...scene.narration, src: silence, timingSrc: undefined},
      events: (scene.events ?? []).map(({sound, ...event}) => event),
      composition: {
        ...scene.composition,
        nodes: await Promise.all(
          (scene.composition?.nodes ?? []).map((node) =>
            materializeNodeSources({
              node,
              project,
              paths,
              coverage,
            }),
          ),
        ),
      },
    })),
  );
  return {
    project: clone,
    coverage: {
      ...coverage,
      total: coverage.actual + coverage.proxy,
      actualRatio:
        coverage.actual + coverage.proxy === 0
          ? 1
          : coverage.actual / (coverage.actual + coverage.proxy),
    },
  };
};

const activeStyleSample = async (slug) => {
  const manifestFile = path.join(
    projectPaths(slug).projectDirectory,
    'assets-manifest.json',
  );
  if (!(await fileExists(manifestFile))) return null;
  const manifest = await readJson(manifestFile);
  const record = (manifest.assets ?? []).find(
    (asset) =>
      (asset.lifecycle?.status ?? 'active') === 'active' &&
      asset.capability === 'image' &&
      asset.request?.quality?.kind === 'style-sample',
  );
  if (!record?.file) return null;
  const absolute = path.resolve(ROOT, record.file);
  if (
    absolute !== ROOT &&
    !absolute.startsWith(`${ROOT}${path.sep}`)
  ) {
    return null;
  }
  if (!(await fileExists(absolute))) return null;
  return {
    assetId: record.assetId,
    file: path.relative(ROOT, absolute),
    sha256: await hashFile(absolute),
  };
};

const requiredArtifactFiles = (report) => [
  report.artifacts?.animatic,
  report.artifacts?.contactSheet,
  report.artifacts?.styleFrame,
  ...(report.scenes ?? []).flatMap(({keyframes, motionClip}) => [
    ...Object.values(keyframes ?? {}),
    motionClip,
  ]),
].filter(Boolean);

const assertWorkspaceArtifact = async (file) => {
  const absolute = path.resolve(ROOT, file);
  if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error(`视觉蓝图产物路径越过工作区：${file}`);
  }
  if (!(await fileExists(absolute))) {
    throw new Error(`视觉蓝图产物不存在：${file}`);
  }
  return absolute;
};

export const assertVisualBlueprintReady = async (slug) => {
  const paths = visualBlueprintPaths(slug);
  if (!(await fileExists(paths.report))) {
    throw new Error(
      '缺少同源视觉蓝图；请先运行 npm run project:visual-blueprint。',
    );
  }
  const [report, {project}, storyboard, runtimeBuildFingerprint] =
    await Promise.all([
      readJson(paths.report),
      loadProject(slug),
      loadStoryboard(slug),
      createRuntimeBuildFingerprint(),
    ]);
  if (
    report.schemaVersion !== 1 ||
    report.projectSlug !== slug ||
    report.reviewMode !== 'single-human-visual-decision'
  ) {
    throw new Error('视觉蓝图格式过旧或不是单次人工视觉决策面；请重新生成。');
  }
  const issues = validateVisualBlueprintExecution({project, storyboard});
  if (issues.length > 0) {
    throw new Error(
      `当前执行树已偏离故事板：${issues
        .map(({location, message}) => `${location}: ${message}`)
        .join('；')}`,
    );
  }
  const currentFingerprint = visualBlueprintFingerprint(project);
  if (
    report.visualContractFingerprint !== currentFingerprint ||
    report.runtimeBuildFingerprint !== runtimeBuildFingerprint
  ) {
    throw new Error('视觉蓝图已过期：场景几何、时序、运动或运行时已变化；请重新生成。');
  }
  if (!report.styleReference?.file) {
    throw new Error(
      '视觉蓝图缺少故事专属风格样张；只允许先生成一次风格样张，再重新生成蓝图。',
    );
  }
  const styleReference = await assertWorkspaceArtifact(
    report.styleReference.file,
  );
  if (await hashFile(styleReference) !== report.styleReference.sha256) {
    throw new Error('故事专属风格样张已变化；请重新生成视觉蓝图。');
  }
  for (const file of requiredArtifactFiles(report)) {
    const absolute = await assertWorkspaceArtifact(file);
    const expected = report.artifactHashes?.[file];
    if (!HASH_PATTERN.test(expected ?? '') || (await hashFile(absolute)) !== expected) {
      throw new Error(`视觉蓝图产物已变化：${file}`);
    }
  }
  if (
    !Array.isArray(report.machineChecks) ||
    report.machineChecks.some(({passed}) => passed !== true)
  ) {
    throw new Error('视觉蓝图技术预检未通过，不能记录人的视觉批准。');
  }
  return {file: paths.report, report, project, storyboard};
};

export const recordVisualBlueprintApproval = async ({
  slug,
  humanNote,
}) => {
  const note = String(humanNote ?? '').trim();
  if (!note) throw new Error('视觉蓝图批准必须保留人的明确原话。');
  const ready = await assertVisualBlueprintReady(slug);
  await assertOperationCircuitClosed({
    slug,
    operation: visualBlueprintReviewOperation,
  });
  const paths = visualBlueprintPaths(slug);
  const record = {
    $schema: '../../schemas/visual-blueprint-approval.schema.json',
    schemaVersion: 1,
    projectSlug: slug,
    status: 'approved',
    blueprintReport: path.relative(ROOT, ready.file),
    blueprintReportSha256: await hashFile(ready.file),
    visualContractFingerprint:
      ready.report.visualContractFingerprint,
    runtimeBuildFingerprint: ready.report.runtimeBuildFingerprint,
    decision: {
      authority: 'human',
      note,
      decidedAt: new Date().toISOString(),
    },
  };
  await writeJson(paths.approval, record);
  await recordOperationSuccess({
    slug,
    operation: visualBlueprintReviewOperation,
    inputFingerprint: ready.report.visualContractFingerprint,
    note: `human approval: ${note}`,
  });
  return {file: paths.approval, record};
};

export const assertVisualBlueprintApprovalCurrent = async (slug) => {
  const paths = visualBlueprintPaths(slug);
  if (!(await fileExists(paths.approval))) {
    throw new Error('正式素材生产前必须获得当前同源视觉蓝图的人工批准。');
  }
  const [approval, ready] = await Promise.all([
    readJson(paths.approval),
    assertVisualBlueprintReady(slug),
  ]);
  if (
    approval.schemaVersion !== 1 ||
    approval.status !== 'approved' ||
    approval.projectSlug !== slug ||
    approval.decision?.authority !== 'human' ||
    !String(approval.decision?.note ?? '').trim()
  ) {
    throw new Error('visual-blueprint-approval.json 无效或缺少人的决定。');
  }
  if (
    approval.visualContractFingerprint !==
      ready.report.visualContractFingerprint ||
    approval.runtimeBuildFingerprint !==
      ready.report.runtimeBuildFingerprint ||
    approval.blueprintReport !== path.relative(ROOT, ready.file) ||
    approval.blueprintReportSha256 !== (await hashFile(ready.file))
  ) {
    throw new Error('视觉蓝图批准已过期；正式生产不得偏离已批准几何与时序。');
  }
  return {file: paths.approval, approval, ready};
};

export const assertProviderVisualBlueprintGate = async (request) => {
  if (request?.quality?.kind === 'style-sample') {
    return {required: false, reason: 'single-style-sample-before-blueprint'};
  }
  const productionFile = projectPaths(request.projectSlug).productionFile;
  if (!(await fileExists(productionFile))) {
    return {
      required: false,
      reason: 'library-fixture-without-production-state',
    };
  }
  const current = await assertVisualBlueprintApprovalCurrent(
    request.projectSlug,
  );
  return {
    required: true,
    reason: 'bulk-provider-production',
    approval: current.approval,
  };
};

export const findVisualBlueprintStyleReference = activeStyleSample;
