import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const STORY_BLUEPRINTS = [
  'layered-reveal',
  'map-journey',
  'archive-stack',
  'character-procession',
  'discovery-wipe',
  'transformation-tableau',
  'chapter-tableau',
  'quiet-lockup',
];

export const PROOF_KINDS = ['establish', 'action', 'peak', 'final'];

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const normalizedTime = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

export const storyboardFileFor = (slug) => {
  if (!SLUG_PATTERN.test(slug ?? '')) throw new Error(`无效项目 slug：${slug}`);
  return path.join(ROOT, 'projects', slug, 'storyboard.json');
};

export const validateStoryboard = (storyboard, {slug, plan} = {}) => {
  const issues = [];
  const add = (code, message, location) => issues.push({code, message, location});
  if (storyboard?.schemaVersion !== 1) {
    add('storyboard-schema-version', 'storyboard.schemaVersion 必须为 1。', 'schemaVersion');
  }
  if (storyboard?.slug !== slug) {
    add('storyboard-slug', `storyboard.slug 必须为 ${slug}。`, 'slug');
  }
  if (!['pending', 'ready'].includes(storyboard?.status)) {
    add('storyboard-status', 'storyboard.status 必须为 pending 或 ready。', 'status');
  }
  if (storyboard?.status !== 'ready') return issues;

  if (!nonEmpty(storyboard.arc)) add('storyboard-arc', '故事板必须写明全片叙事弧。', 'arc');
  const style = storyboard.style;
  if (!style || typeof style !== 'object') {
    add('storyboard-style', '故事板必须包含 style。', 'style');
  } else {
    for (const key of ['visualThesis', 'layerStrategy']) {
      if (!nonEmpty(style[key])) add(`storyboard-style-${key}`, `style.${key} 不能为空。`, `style.${key}`);
    }
    for (const key of ['compositionRules', 'motionLanguage']) {
      if (!Array.isArray(style[key]) || style[key].length === 0 || style[key].some((item) => !nonEmpty(item))) {
        add(`storyboard-style-${key}`, `style.${key} 必须包含至少一条明确规则。`, `style.${key}`);
      }
    }
  }

  const scenes = storyboard.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    add('storyboard-scenes', 'ready 故事板至少需要一个镜头。', 'scenes');
    return issues;
  }
  if (plan?.status === 'resolved' && scenes.length !== plan.resolved?.sceneCount) {
    add(
      'storyboard-scene-count',
      `故事板需要 ${plan.resolved?.sceneCount} 个镜头，当前为 ${scenes.length} 个。`,
      'scenes',
    );
  }
  const sceneIds = new Set();
  let estimatedDuration = 0;
  for (const [sceneIndex, scene] of scenes.entries()) {
    const location = `scenes[${sceneIndex}]`;
    if (!nonEmpty(scene.id) || sceneIds.has(scene.id)) {
      add('storyboard-scene-id', '镜头 id 缺失或重复。', `${location}.id`);
    }
    sceneIds.add(scene.id);
    for (const key of ['title', 'narrativeRole', 'message']) {
      if (!nonEmpty(scene[key])) add(`storyboard-scene-${key}`, `${key} 不能为空。`, `${location}.${key}`);
    }
    if (!STORY_BLUEPRINTS.includes(scene.blueprint)) {
      add('storyboard-blueprint', `未知镜头蓝图：${scene.blueprint}`, `${location}.blueprint`);
    }
    if (!(typeof scene.estimatedDurationSeconds === 'number' && scene.estimatedDurationSeconds > 0)) {
      add('storyboard-duration', 'estimatedDurationSeconds 必须大于 0。', `${location}.estimatedDurationSeconds`);
    } else {
      estimatedDuration += scene.estimatedDurationSeconds;
    }
    if (!Array.isArray(scene.beats) || scene.beats.length < 3) {
      add('storyboard-beats', '每个镜头至少需要 3 个节拍。', `${location}.beats`);
    }
    const beatIds = new Set();
    let previousBeat = -1;
    for (const [beatIndex, beat] of (scene.beats ?? []).entries()) {
      const beatLocation = `${location}.beats[${beatIndex}]`;
      if (!nonEmpty(beat.id) || beatIds.has(beat.id)) add('storyboard-beat-id', '节拍 id 缺失或重复。', `${beatLocation}.id`);
      beatIds.add(beat.id);
      if (!normalizedTime(beat.at) || beat.at <= previousBeat) {
        add('storyboard-beat-time', '节拍 at 必须位于 0..1 且严格递增。', `${beatLocation}.at`);
      }
      previousBeat = beat.at;
      for (const key of ['purpose', 'visual', 'motion']) {
        if (!nonEmpty(beat[key])) add(`storyboard-beat-${key}`, `${key} 不能为空。`, `${beatLocation}.${key}`);
      }
      if (beat.audioCue !== null && beat.audioCue !== undefined && !nonEmpty(beat.audioCue)) {
        add('storyboard-beat-audio', 'audioCue 必须为非空字符串或 null。', `${beatLocation}.audioCue`);
      }
    }
    if (!Array.isArray(scene.proofTimes) || scene.proofTimes.length < 3) {
      add('storyboard-proof-times', '每个镜头至少需要 3 个证明时刻。', `${location}.proofTimes`);
    }
    let previousProof = -1;
    let hasFinal = false;
    for (const [proofIndex, proof] of (scene.proofTimes ?? []).entries()) {
      const proofLocation = `${location}.proofTimes[${proofIndex}]`;
      if (!normalizedTime(proof.at) || proof.at <= previousProof) {
        add('storyboard-proof-time', '证明时刻 at 必须位于 0..1 且严格递增。', `${proofLocation}.at`);
      }
      previousProof = proof.at;
      if (!nonEmpty(proof.label)) add('storyboard-proof-label', '证明时刻必须有 label。', `${proofLocation}.label`);
      if (!PROOF_KINDS.includes(proof.kind)) add('storyboard-proof-kind', `未知证明类型：${proof.kind}`, `${proofLocation}.kind`);
      if (proof.kind === 'final' && proof.at >= 0.82) hasFinal = true;
    }
    if (!hasFinal) add('storyboard-final-proof', '每个镜头必须在 0.82 之后设置 final 证明时刻。', `${location}.proofTimes`);
  }

  const plannedDuration = plan?.status === 'resolved' ? plan.resolved?.durationSeconds : null;
  if (plannedDuration && Math.abs(estimatedDuration - plannedDuration) > Math.max(1, plannedDuration * 0.08)) {
    add(
      'storyboard-duration-total',
      `镜头预计总时长 ${estimatedDuration.toFixed(2)}s 与计划 ${plannedDuration.toFixed(2)}s 相差超过 8%。`,
      'scenes',
    );
  }
  return issues;
};

export const loadStoryboard = async (slug) =>
  JSON.parse(await fs.readFile(storyboardFileFor(slug), 'utf8'));

export const assertStoryboardReady = async (slug, plan) => {
  let storyboard;
  try {
    storyboard = await loadStoryboard(slug);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('缺少 storyboard.json；请先运行 project:storyboard。');
    throw error;
  }
  const issues = validateStoryboard(storyboard, {slug, plan});
  if (storyboard.status !== 'ready' || issues.length > 0) {
    const detail = issues.map(({location, message}) => `${location}: ${message}`).join('；');
    throw new Error(`故事板尚未就绪；请先运行 project:storyboard。${detail ? ` ${detail}` : ''}`);
  }
  return storyboard;
};

export const summarizeStoryboard = (storyboard) => ({
  status: storyboard?.status ?? 'missing',
  arc: storyboard?.status === 'ready' ? storyboard.arc : null,
  sceneCount: Array.isArray(storyboard?.scenes) ? storyboard.scenes.length : 0,
  scenes:
    storyboard?.status === 'ready'
      ? storyboard.scenes.map(({id, title, narrativeRole, blueprint, beats, proofTimes}) => ({
          id,
          title,
          narrativeRole,
          blueprint,
          beatCount: beats.length,
          proofCount: proofTimes.length,
        }))
      : [],
});
