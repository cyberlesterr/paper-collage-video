import {createHash} from 'node:crypto';
import path from 'node:path';
import {
  ROOT,
  fileExists,
  projectPaths,
  readJson,
  writeJsonTransaction,
} from './project-lib.mjs';

const CORE_PROVIDER_CAPABILITIES = ['text', 'image', 'voice'];

const slugToken = (value) =>
  String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28);

export const soundEffectAssetId = (cue) => {
  const token = slugToken(cue) || 'cue';
  const digest = createHash('sha256')
    .update(String(cue))
    .digest('hex')
    .slice(0, 10);
  return `sfx-${token}-${digest}`;
};

export const compileSceneSoundEffects = ({scene, projectSlug}) =>
  (scene.beats ?? [])
    .filter(({soundCue}) => typeof soundCue === 'string' && soundCue.trim())
    .map((beat) => {
      const cue = beat.soundCue.trim();
      const assetId = soundEffectAssetId(cue);
      return {
        id: `${scene.id}-${beat.id}-sound`,
        sceneId: scene.id,
        beatId: beat.id,
        targetId: beat.treatments?.[0]?.targetId ?? 'scene-audio',
        cue,
        at: beat.at,
        proofTimeId: beat.proofTimeId,
        assetId,
        output:
          `public/projects/${projectSlug}/audio/sfx/${assetId}.wav`,
      };
    });

export const soundEffectPlanFor = (storyboard) => {
  const entries = (storyboard.scenes ?? []).flatMap(
    ({compositionPlan}) => compositionPlan?.soundEffects ?? [],
  );
  const assets = new Map();
  for (const entry of entries) {
    const current = assets.get(entry.assetId) ?? {
      assetId: entry.assetId,
      cue: entry.cue,
      output: entry.output,
      bindings: [],
    };
    current.bindings.push({
      sceneId: entry.sceneId,
      beatId: entry.beatId,
      targetId: entry.targetId,
      at: entry.at,
      proofTimeId: entry.proofTimeId,
    });
    assets.set(entry.assetId, current);
  }
  return {
    schemaVersion: 1,
    projectSlug: storyboard.slug,
    required: entries.length > 0,
    requiredSoundEffectCount: assets.size,
    assets: [...assets.values()].sort((left, right) =>
      left.assetId.localeCompare(right.assetId),
    ),
  };
};

export const requiredProviderCapabilitiesForStoryboard = (storyboard) => [
  ...CORE_PROVIDER_CAPABILITIES,
  ...(soundEffectPlanFor(storyboard).required ? ['sound'] : []),
];

export const soundEffectArtifactsFor = async (storyboard) => {
  const plan = {
    $schema: '../../schemas/sound-effect-plan.schema.json',
    ...soundEffectPlanFor(storyboard),
  };
  const paths = projectPaths(storyboard.slug);
  const reportFile = path.join(
    paths.projectDirectory,
    'sound-effect-plan.json',
  );
  const requests = plan.assets.map((asset) => ({
    file: path.join(
      paths.projectDirectory,
      'requests',
      `${asset.assetId}.json`,
    ),
    value: {
      $schema: '../../../schemas/asset-request.schema.json',
      schemaVersion: 8,
      projectSlug: storyboard.slug,
      assetId: asset.assetId,
      capability: 'sound',
      output: asset.output,
      prompt:
        `Generate one short, clean, non-musical sound effect for "${asset.cue}". ` +
        'No speech, no narration, no background music, no watermark or spoken tag. ' +
        'Use a concise transient and natural decay suitable for a children-oriented illustrated story.',
      soundBinding: {
        cue: asset.cue,
        bindings: asset.bindings,
      },
    },
  }));
  const previous = (await fileExists(reportFile))
    ? await readJson(reportFile)
    : null;
  const currentIds = new Set(plan.assets.map(({assetId}) => assetId));
  const staleRequests = (previous?.assets ?? [])
    .map(({assetId}) => assetId)
    .filter(
      (assetId) =>
        typeof assetId === 'string' &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(assetId) &&
        !currentIds.has(assetId),
    )
    .map((assetId) => ({
      file: path.join(
        paths.projectDirectory,
        'requests',
        `${assetId}.json`,
      ),
      delete: true,
    }));
  return {
    file: reportFile,
    plan,
    requests: requests.map(({file}) => path.relative(ROOT, file)),
    entries: [
      {file: reportFile, value: plan},
      ...requests,
      ...staleRequests,
    ],
    removedRequests: staleRequests.map(({file}) => path.relative(ROOT, file)),
  };
};

export const writeSoundEffectPlan = async (storyboard) => {
  const artifacts = await soundEffectArtifactsFor(storyboard);
  await writeJsonTransaction(artifacts.entries);
  return {
    file: artifacts.file,
    plan: artifacts.plan,
    requests: artifacts.requests,
    removedRequests: artifacts.removedRequests,
  };
};

export const requiredProviderCapabilitiesForProject = async (slug) => {
  const reportFile = path.join(
    projectPaths(slug).projectDirectory,
    'sound-effect-plan.json',
  );
  if (!(await fileExists(reportFile))) return [...CORE_PROVIDER_CAPABILITIES];
  const plan = await readJson(reportFile);
  return [
    ...CORE_PROVIDER_CAPABILITIES,
    ...(plan?.schemaVersion === 1 && plan.required ? ['sound'] : []),
  ];
};
