#!/usr/bin/env node
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const PLUGIN_ROOT = path.join(ROOT, 'plugins', 'paper-collage-video');
const RUNTIME_ROOT = path.join(PLUGIN_ROOT, 'assets', 'remotion-template');
const SKILL_SOURCE = path.join(ROOT, 'skills', 'make-paper-collage-video');
const SKILL_TARGET = path.join(
  PLUGIN_ROOT,
  'skills',
  'make-paper-collage-video',
);

const copy = async (relativeSource, relativeTarget = relativeSource) => {
  const source = path.join(ROOT, relativeSource);
  const target = path.join(RUNTIME_ROOT, relativeTarget);
  await fs.mkdir(path.dirname(target), {recursive: true});
  await fs.cp(source, target, {recursive: true});
};

const writeJson = async (file, value) => {
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const makeTestToneWav = ({sampleRate = 48000, seconds = 1} = {}) => {
  const channels = 1;
  const bitsPerSample = 16;
  const sampleCount = sampleRate * seconds;
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  const amplitude = Math.round(32767 * 0.1);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const value = Math.round(
      Math.sin((sample / sampleRate) * Math.PI * 2 * 440) * amplitude,
    );
    buffer.writeInt16LE(value, 44 + sample * 2);
  }
  return buffer;
};

const hashFile = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

const runtimeAssetId = (file) =>
  `runtime-${createHash('sha256').update(file).digest('hex').slice(0, 12)}`;

await fs.rm(RUNTIME_ROOT, {recursive: true, force: true});
await fs.rm(SKILL_TARGET, {recursive: true, force: true});
await fs.mkdir(RUNTIME_ROOT, {recursive: true});
await fs.mkdir(path.dirname(SKILL_TARGET), {recursive: true});
await fs.cp(SKILL_SOURCE, SKILL_TARGET, {recursive: true});
for (const notice of ['LICENSE', 'ASSET_LICENSES.md', 'THIRD_PARTY_NOTICES.md']) {
  await fs.copyFile(path.join(ROOT, notice), path.join(PLUGIN_ROOT, notice));
}

for (const entry of [
  '.gitignore',
  'LICENSE',
  'ASSET_LICENSES.md',
  'THIRD_PARTY_NOTICES.md',
  'package-lock.json',
  'providers.local.example.json',
  'providers.json',
  'requirements.txt',
  'tsconfig.json',
  'schemas',
  'templates',
  'scripts/creative-plan-lib.mjs',
  'scripts/composition-lib.mjs',
  'scripts/process-character-sheet.mjs',
  'scripts/python-runtime.mjs',
  'scripts/provider-lib.mjs',
  'scripts/provider-reuse.mjs',
  'scripts/provider-select.mjs',
  'scripts/provider-record.mjs',
  'scripts/provider-run.mjs',
  'scripts/provider-status.mjs',
  'scripts/production-state.mjs',
  'scripts/project-advance.mjs',
  'scripts/project-assets-ready.mjs',
  'scripts/project-checkpoint.mjs',
  'scripts/project-confirm-concept.mjs',
  'scripts/project-composition-proof.mjs',
  'scripts/project-doctor.mjs',
  'scripts/project-handoff-check.mjs',
  'scripts/project-lib.mjs',
  'scripts/project-new.mjs',
  'scripts/project-plan.mjs',
  'scripts/project-quality.mjs',
  'scripts/project-render.mjs',
  'scripts/project-report.mjs',
  'scripts/project-review-sync.mjs',
  'scripts/project-status.mjs',
  'scripts/project-storyboard.mjs',
  'scripts/storyboard-lib.mjs',
  'scripts/project-sync.mjs',
  'scripts/project-subtitles.mjs',
  'scripts/project-validate.mjs',
  'scripts/quality-lib.mjs',
  'scripts/rasterize-assets.mjs',
  'scripts/remove_chroma_key.py',
  'scripts/split_sheet.py',
  'scripts/subtitle-lib.mjs',
  'scripts/style-motion-proof.mjs',
  'src/MainVideo.tsx',
  'src/motion.ts',
  'src/ReplicaChapterScene.tsx',
  'src/index.ts',
  'src/project.ts',
  'src/roleMotion.ts',
  'tests/provider-and-assets.test.mjs',
  'tests/creative-plan.test.mjs',
  'tests/composition-v4.test.mjs',
  'tests/production-state.test.mjs',
  'tests/quality-motion-runtime.test.mjs',
  'tests/storyboard-motion.test.mjs',
  'fixtures/composition-v4',
  'public/fixtures/composition-v4',
  'public/textures/paper-grain.png',
]) {
  await copy(entry);
}

const rootPackage = JSON.parse(
  await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'),
);
const workspacePackage = {
  ...rootPackage,
  name: 'paper-collage-video-workspace',
  version: rootPackage.version,
  private: true,
  engines: {node: '>=20'},
  scripts: {
    'assets:rasterize': rootPackage.scripts['assets:rasterize'],
    'assets:process-sheet': rootPackage.scripts['assets:process-sheet'],
    'provider:status': rootPackage.scripts['provider:status'],
    'provider:select': rootPackage.scripts['provider:select'],
    'provider:run': rootPackage.scripts['provider:run'],
    'provider:record': rootPackage.scripts['provider:record'],
    'provider:reuse': rootPackage.scripts['provider:reuse'],
    'project:new': rootPackage.scripts['project:new'],
    'project:plan': rootPackage.scripts['project:plan'],
    'project:storyboard': rootPackage.scripts['project:storyboard'],
    'project:confirm-concept': rootPackage.scripts['project:confirm-concept'],
    'project:quality': rootPackage.scripts['project:quality'],
    'project:composition-proof': rootPackage.scripts['project:composition-proof'],
    'project:resume': rootPackage.scripts['project:resume'],
    'project:status': rootPackage.scripts['project:status'],
    'project:handoff-check': rootPackage.scripts['project:handoff-check'],
    'project:checkpoint': rootPackage.scripts['project:checkpoint'],
    'project:review-sync': rootPackage.scripts['project:review-sync'],
    'project:advance': rootPackage.scripts['project:advance'],
    'project:assets-ready': rootPackage.scripts['project:assets-ready'],
    'project:sync': rootPackage.scripts['project:sync'],
    'project:subtitles': rootPackage.scripts['project:subtitles'],
    'project:validate': rootPackage.scripts['project:validate'],
    'project:preview': rootPackage.scripts['project:preview'],
    'project:render': rootPackage.scripts['project:render'],
    'project:report': rootPackage.scripts['project:report'],
    'style:proof': rootPackage.scripts['style:proof'],
    doctor: 'node scripts/project-doctor.mjs',
    dev: 'remotion studio src/index.ts --props=projects/starter-demo/project.json',
    check: rootPackage.scripts.check,
    bundle: rootPackage.scripts.bundle,
    test: rootPackage.scripts.test,
    render: 'npm run project:render -- starter-demo',
    'render:preview': 'npm run project:preview -- starter-demo',
  },
};
await writeJson(path.join(RUNTIME_ROOT, 'package.json'), workspacePackage);

const lock = JSON.parse(
  await fs.readFile(path.join(RUNTIME_ROOT, 'package-lock.json'), 'utf8'),
);
lock.name = workspacePackage.name;
lock.version = workspacePackage.version;
lock.packages[''].name = workspacePackage.name;
lock.packages[''].version = workspacePackage.version;
lock.packages[''].license = workspacePackage.license;
await writeJson(path.join(RUNTIME_ROOT, 'package-lock.json'), lock);

const rootSource = `import {Composition, type CalculateMetadataFunction} from 'remotion';
import starterDemo from '../projects/starter-demo/project.json';
import {MainVideo} from './MainVideo';
import {normalizeProject, type PaperCollageProject} from './project';

const defaultProject = starterDemo as PaperCollageProject;

const calculateProjectMetadata: CalculateMetadataFunction<PaperCollageProject> = ({props}) => {
  const normalized = normalizeProject(props);
  return {
    durationInFrames: normalized.durationInFrames,
    fps: normalized.video.fps,
    width: normalized.video.width,
    height: normalized.video.height,
    defaultOutName: \`${'${normalized.slug}'}.mp4\`,
  };
};

export const RemotionRoot = () => (
  <Composition
    id="Paper-Collage"
    component={MainVideo}
    defaultProps={defaultProject}
    calculateMetadata={calculateProjectMetadata}
  />
);
`;
await fs.writeFile(path.join(RUNTIME_ROOT, 'src', 'Root.tsx'), rootSource, 'utf8');

const project = {
  $schema: '../../schemas/project.schema.json',
  schemaVersion: 4,
  slug: 'starter-demo',
  title: 'Paper Collage Starter',
  plan: {
    schemaVersion: 1,
    slug: 'starter-demo',
    status: 'resolved',
    inputMode: 'both',
    productionProfile: 'draft',
    assetBudget: {
      backgrounds: 1,
      environmentLayers: 1,
      characterSheets: 1,
      styleSamples: 1,
      maxGeneratedImages: 4,
    },
    requested: {durationSeconds: 2, sceneCount: 1},
    resolved: {
      durationSeconds: 2,
      sceneCount: 1,
      estimatedNarrationSeconds: 1,
      rationale: 'Bundled technical fixture',
      resolvedAt: '2026-01-01T00:00:00.000Z',
    },
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  quality: {minimumAssetScale: 0.5},
  video: {width: 1920, height: 1080, fps: 30},
  theme: {
    canvas: '#6e1e19',
    sceneBackground: '#8a271f',
    accent: '#a33a2d',
    ink: '#4a291f',
    subtitle: '#fff8ea',
    subtitleBackground: 'rgba(58, 25, 18, .72)',
    paperEdge: '#f5eedc',
    foreground: '#8d251e',
    texture: 'textures/paper-grain.png',
  },
  voice: {mode: 'fictional', provider: 'fixture', displayName: 'Test tone fixture'},
  audio: {
    narration: {volume: 1},
    music: null,
    mastering: {targetLufs: -24, toleranceLufs: 3, truePeakDbtp: -18},
  },
  scenes: [
    {
      id: 'starter',
      label: '纸片分层视频',
      eyebrow: 'STARTER',
      tailSeconds: 1,
      motion: {
        blueprint: 'layered-reveal',
        intensity: 0.7,
        seed: 17,
        proofTimes: [
          {id: 'proof-establish', at: 0.08, label: '建立纸面空间', kind: 'establish', assertions: ['背景完整建立']},
          {id: 'proof-action', at: 0.5, label: '主体进入画面', kind: 'peak', assertions: ['主体位于画面中央']},
          {id: 'proof-final', at: 0.9, label: '标题与主体稳定', kind: 'final', assertions: ['主体与标题构图稳定']},
        ],
      },
      composition: {
        coordinateSpace: {width: 1920, height: 1080},
        nodes: [
          {
            id: 'background',
            kind: 'asset',
            assetRole: 'background',
            src: 'projects/starter-demo/assets/plates/01-bg.png',
            z: 0,
            transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
            motion: {keyframes: [{at: 0, scale: 1}, {at: 1, scale: 1.015, ease: 'ease-in-out'}]},
          },
          {
            id: 'traveler',
            kind: 'asset',
            assetRole: 'character',
            src: 'projects/starter-demo/assets/characters/alpha/01-traveler.png',
            z: 4,
            transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
            motion: {
              idle: {preset: 'breathe', intensity: 0.5, cycleSeconds: 2.8},
              keyframes: [
                {at: 0, x: -0.01, opacity: 0.72, ease: 'ease-out'},
                {at: 0.5, x: 0.003, scale: 1.03, opacity: 1, ease: 'ease-in-out'},
                {at: 1, x: 0, scale: 1, opacity: 1, ease: 'ease-out'},
              ],
            },
          },
        ],
      },
      camera: {preset: 'push', intensity: 0.6},
      transition: {type: 'none', durationSeconds: 0},
      narration: {
        src: 'projects/starter-demo/audio/narration/01-test-tone.wav',
        startSeconds: 0,
        durationSeconds: 1,
        text: '',
      },
      subtitles: [{fromSeconds: 0, toSeconds: 1.8, text: 'Paper Collage Video'}],
      cues: [
        {id: 'establish', beatId: 'establish', at: 0, durationSeconds: 0.35, targetId: 'scene', action: 'reveal', intensity: 0.7},
        {id: 'subject-arrives', beatId: 'subject-arrives', at: 0.5, durationSeconds: 0.5, targetId: 'traveler', action: 'lift', intensity: 0.8},
        {id: 'lockup', beatId: 'lockup', at: 0.9, durationSeconds: 0.25, targetId: 'traveler', action: 'settle', intensity: 0.55},
      ],
    },
  ],
};
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'project.json'),
  project,
);

const storyboard = {
  $schema: '../../schemas/storyboard.schema.json',
  schemaVersion: 1,
  slug: 'starter-demo',
  status: 'ready',
  arc: '从空纸面建立分层空间，再让主体进入并稳定成标题画面。',
  style: {
    visualThesis: '以可见纸张深度和克制动作证明可编辑的拼贴空间。',
    compositionRules: ['主体保持在字幕安全区上方', '前中后景至少形成两个深度层次'],
    motionLanguage: ['先建立空间，再触发主体，最后稳定锁定'],
    layerStrategy: '背景承载空间，透明主体承载动作，前景纸片负责压边。',
  },
  scenes: [
    {
      id: 'starter',
      title: '纸片分层视频',
      narrativeRole: '开场与能力证明',
      message: '纸拼贴镜头由有节奏的分层运动构成。',
      blueprint: 'layered-reveal',
      estimatedDurationSeconds: 2,
      beats: [
        {id: 'establish', at: 0, purpose: '建立空间', visual: '纸面与背景出现', motion: '场景淡入', audioCue: null},
        {id: 'subject-arrives', at: 0.5, purpose: '交付主体', visual: '人物纸片进入中心', motion: '主体上提并轻微放大', audioCue: null},
        {id: 'lockup', at: 0.9, purpose: '稳定结论', visual: '人物与标题形成锁定构图', motion: '主体回落稳定', audioCue: null},
      ],
      proofTimes: [
        {id: 'proof-establish', at: 0.08, label: '建立纸面空间', kind: 'establish', assertions: ['背景完整建立']},
        {id: 'proof-action', at: 0.5, label: '主体进入画面', kind: 'peak', assertions: ['主体位于画面中央']},
        {id: 'proof-final', at: 0.9, label: '标题与主体稳定', kind: 'final', assertions: ['主体与标题构图稳定']},
      ],
      compositionPlan: {
        patterns: ['free'],
        relationships: [
          {id: 'traveler-over-background', subject: 'traveler', predicate: 'free', object: 'background', proof: '主体独立于背景运动且构图可读'},
        ],
      },
    },
  ],
  updatedAt: '2026-01-01T00:00:00.000Z',
};
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'storyboard.json'),
  storyboard,
);

const at = '2026-01-01T00:00:00.000Z';
const production = {
  $schema: '../../schemas/production.schema.json',
  schemaVersion: 1,
  slug: 'starter-demo',
  stage: 'complete',
  createdAt: at,
  updatedAt: at,
  approvals: Object.fromEntries(
    ['concept', 'styleAndVoice', 'preview', 'publish'].map((key) => [
      key,
      {status: 'approved', decidedAt: at, note: 'Bundled fixture'},
    ]),
  ),
  workItems: [],
  artifacts: {
    brief: 'projects/starter-demo/brief.md',
    project: 'projects/starter-demo/project.json',
    storyboard: 'projects/starter-demo/storyboard.json',
    prompts: 'projects/starter-demo/prompts.json',
    review: 'projects/starter-demo/review.md',
    validationReport: null,
    preview: null,
    final: null,
    report: null,
    contactSheet: null,
  },
  history: [{at, action: 'fixture-created', stage: 'complete', note: ''}],
};
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'production.json'),
  production,
);
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'prompts.json'),
  {imageModel: 'fixture', assets: []},
);
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'providers.json'),
  {$schema: '../../schemas/providers.schema.json', schemaVersion: 1},
);
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'assets-manifest.json'),
  {
    $schema: '../../schemas/assets-manifest.schema.json',
    schemaVersion: 3,
    projectSlug: 'starter-demo',
    assets: [],
  },
);
await fs.writeFile(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'brief.md'),
  '# 项目简报：Paper Collage Starter\n\n这是插件自带的轻量技术样例。\n',
  'utf8',
);
await fs.writeFile(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'review.md'),
  '# 验收记录：Paper Collage Starter\n\n- Bundled fixture\n',
  'utf8',
);
const starterRequests = path.join(
  RUNTIME_ROOT,
  'projects',
  'starter-demo',
  'requests',
);
await fs.mkdir(starterRequests, {recursive: true});
await fs.writeFile(path.join(starterRequests, '.gitkeep'), '', 'utf8');

await copy(
  'fixtures/starter-demo/01-bg.png',
  'public/projects/starter-demo/assets/plates/01-bg.png',
);
await copy(
  'fixtures/starter-demo/01-traveler.png',
  'public/projects/starter-demo/assets/characters/alpha/01-traveler.png',
);
const narrationFile = path.join(
  RUNTIME_ROOT,
  'public',
  'projects',
  'starter-demo',
  'audio',
  'narration',
  '01-test-tone.wav',
);
await fs.mkdir(path.dirname(narrationFile), {recursive: true});
await fs.writeFile(narrationFile, makeTestToneWav());

const fixtureQualityAssets = [
  {
    file: 'public/projects/starter-demo/assets/plates/01-bg.png',
    kind: 'background',
    source: 'scene:starter:node:background',
    checks: ['no-text', 'no-watermark', 'no-people', 'safe-area-clear', 'style-consistent'],
  },
  {
    file: 'public/projects/starter-demo/assets/characters/alpha/01-traveler.png',
    kind: 'character',
    source: 'scene:starter:node:traveler',
    checks: ['subject-complete', 'identity-consistent', 'edge-clean', 'style-consistent'],
  },
];
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'quality-report.json'),
  {
    $schema: '../../schemas/quality-report.schema.json',
    schemaVersion: 2,
    projectSlug: 'starter-demo',
    updatedAt: at,
    cueEvents: [],
    assets: await Promise.all(
      fixtureQualityAssets.map(async ({file, kind, source, checks}) => ({
        assetId: runtimeAssetId(file),
        file,
        kind,
        sources: [source],
        sha256: await hashFile(path.join(RUNTIME_ROOT, file)),
        requiredChecks: checks,
        technical: {passed: true, checks: []},
        semanticChecks: Object.fromEntries(checks.map((check) => [check, 'passed'])),
        status: 'passed',
        reviewer: 'bundled-fixture',
        reviewedAt: at,
        note: 'Repository-owned technical fixture',
      })),
    ),
    composites: [],
  },
);

await writeJson(path.join(RUNTIME_ROOT, '.paper-collage-template.json'), {
  schemaVersion: 1,
  plugin: 'paper-collage-video',
  pluginVersion: rootPackage.version,
});

console.log(`✓ Plugin skill synced: ${path.relative(ROOT, SKILL_TARGET)}`);
console.log(`✓ Runtime template synced: ${path.relative(ROOT, RUNTIME_ROOT)}`);
