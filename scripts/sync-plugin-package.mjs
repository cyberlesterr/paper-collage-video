#!/usr/bin/env node
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

const makeSilentWav = ({sampleRate = 48000, seconds = 1} = {}) => {
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
  return buffer;
};

await fs.rm(RUNTIME_ROOT, {recursive: true, force: true});
await fs.rm(SKILL_TARGET, {recursive: true, force: true});
await fs.mkdir(RUNTIME_ROOT, {recursive: true});
await fs.mkdir(path.dirname(SKILL_TARGET), {recursive: true});
await fs.cp(SKILL_SOURCE, SKILL_TARGET, {recursive: true});

for (const entry of [
  '.gitignore',
  'package-lock.json',
  'requirements.txt',
  'tsconfig.json',
  'schemas',
  'templates',
  'scripts/process-character-sheet.mjs',
  'scripts/production-state.mjs',
  'scripts/project-advance.mjs',
  'scripts/project-checkpoint.mjs',
  'scripts/project-doctor.mjs',
  'scripts/project-handoff-check.mjs',
  'scripts/project-lib.mjs',
  'scripts/project-new.mjs',
  'scripts/project-render.mjs',
  'scripts/project-report.mjs',
  'scripts/project-review-sync.mjs',
  'scripts/project-status.mjs',
  'scripts/project-sync.mjs',
  'scripts/project-validate.mjs',
  'scripts/rasterize-assets.mjs',
  'scripts/remove_chroma_key.py',
  'scripts/split_sheet.py',
  'src/MainVideo.tsx',
  'src/ReplicaChapterScene.tsx',
  'src/index.ts',
  'src/project.ts',
  'src/roleMotion.ts',
  'tests/production-state.test.mjs',
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
  version: '0.1.0',
  private: true,
  engines: {node: '>=20'},
  scripts: {
    'assets:rasterize': rootPackage.scripts['assets:rasterize'],
    'assets:process-sheet': rootPackage.scripts['assets:process-sheet'],
    'project:new': rootPackage.scripts['project:new'],
    'project:status': rootPackage.scripts['project:status'],
    'project:handoff-check': rootPackage.scripts['project:handoff-check'],
    'project:checkpoint': rootPackage.scripts['project:checkpoint'],
    'project:review-sync': rootPackage.scripts['project:review-sync'],
    'project:advance': rootPackage.scripts['project:advance'],
    'project:sync': rootPackage.scripts['project:sync'],
    'project:validate': rootPackage.scripts['project:validate'],
    'project:preview': rootPackage.scripts['project:preview'],
    'project:render': rootPackage.scripts['project:render'],
    'project:report': rootPackage.scripts['project:report'],
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
  schemaVersion: 1,
  slug: 'starter-demo',
  title: 'Paper Collage Starter',
  video: {width: 1920, height: 1080, fps: 30, transitionFrames: 12},
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
  voice: {mode: 'fictional', provider: 'fixture', displayName: 'Silent fixture'},
  audio: {music: null, sfx: {}},
  scenes: [
    {
      id: 'starter',
      label: '纸片分层视频',
      eyebrow: 'STARTER',
      tailFrames: 30,
      background: 'projects/starter-demo/assets/plates/01-bg.png',
      narration: {
        src: 'projects/starter-demo/audio/narration/01-silence.wav',
        startFrame: 0,
        durationSeconds: 1,
        text: '',
      },
      layers: [
        {
          id: 'traveler',
          src: 'projects/starter-demo/assets/characters/alpha/01-traveler.png',
          role: 'primary',
          x: 0,
          bottom: 0,
          width: 1920,
          z: 4,
          delay: 0,
          enterFrom: 'left',
        },
      ],
      subtitles: [{from: 0, to: 54, text: 'Paper Collage Video'}],
    },
  ],
};
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'project.json'),
  project,
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

await copy('public/layers/sky.png', 'public/projects/starter-demo/assets/plates/01-bg.png');
await copy(
  'public/layers/traveler.png',
  'public/projects/starter-demo/assets/characters/alpha/01-traveler.png',
);
const narrationFile = path.join(
  RUNTIME_ROOT,
  'public',
  'projects',
  'starter-demo',
  'audio',
  'narration',
  '01-silence.wav',
);
await fs.mkdir(path.dirname(narrationFile), {recursive: true});
await fs.writeFile(narrationFile, makeSilentWav());

await writeJson(path.join(RUNTIME_ROOT, '.paper-collage-template.json'), {
  schemaVersion: 1,
  plugin: 'paper-collage-video',
  pluginVersion: '0.1.0',
});

console.log(`✓ Plugin skill synced: ${path.relative(ROOT, SKILL_TARGET)}`);
console.log(`✓ Runtime template synced: ${path.relative(ROOT, RUNTIME_ROOT)}`);
