import {stableValue} from './contract-utils.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const fingerprint = (value) =>
  createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');

const escapeXml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character]);

export const worldTopologyProofFingerprint = ({scene, world}) =>
  fingerprint({
    sceneId: scene.id,
    proofTimes: scene.proofTimes,
    world,
  });

const proofTimesFor = ({scene, world}) => {
  const byId = new Map((scene.proofTimes ?? []).map((proof) => [proof.id, proof]));
  return Object.fromEntries(
    ['before', 'seam', 'after'].map((key) => [
      key,
      byId.get(world.seamProofTimeIds?.[key])?.at ?? null,
    ]),
  );
};

const check = (id, passed, message) => ({id, passed, message});

export const inspectWorldTopologyPlan = ({scene, world}) => {
  const proofTimes = proofTimesFor({scene, world});
  const strips = world.strips ?? [];
  const tracked = (world.subjectBindings ?? []).filter(
    ({role, anchorMode}) => role === 'tracked' && anchorMode === 'screen',
  );
  const participantIds = new Set(
    (world.subjectBindings ?? []).map(({nodeId}) => nodeId),
  );
  const orderedProofTimes = ['before', 'seam', 'after'].map(
    (key) => proofTimes[key],
  );
  const roles = new Set(strips.map(({role}) => role));
  const checks = [
    check(
      'world-travel-distance',
      Number.isFinite(world.distanceViewports) && world.distanceViewports >= 1,
      '主体旅行世界必须产生至少一个视口宽度的可测地面位移。',
    ),
    check(
      'world-depth-stack',
      strips.length >= 3 &&
        roles.has('ground') &&
        roles.has('far') &&
        (roles.has('mid') || roles.has('near')),
      '连续世界必须至少包含 far、ground 和一个 mid/near 景深层。',
    ),
    check(
      'world-depth-speed-order',
      Number.isFinite(world.speedRange?.far) &&
        Number.isFinite(world.speedRange?.near) &&
        world.speedRange.far > 0 &&
        world.speedRange.near > world.speedRange.far,
      '近景世界速度必须严格大于远景速度。',
    ),
    check(
      'world-tracked-subject',
      tracked.length === 1,
      '连续世界必须且只能包含一个 screen-anchored tracked 旅行主体。',
    ),
    check(
      'world-ground-binding',
      strips.some(
        ({id, role, surfaceRole}) =>
          id === world.groundStripId &&
          role === 'ground' &&
          surfaceRole === 'walkable-ground',
      ),
      'groundStripId 必须绑定真实 walkable-ground 条带。',
    ),
    check(
      'world-proof-order',
      orderedProofTimes.every(Number.isFinite) &&
        orderedProofTimes[0] < orderedProofTimes[1] &&
        orderedProofTimes[1] < orderedProofTimes[2],
      'before、seam、after 三个证明时刻必须存在且严格递增。',
    ),
    check(
      'world-subject-identity',
      participantIds.size === (world.subjectBindings ?? []).length,
      '连续世界中的 tracked/participant 节点 id 必须唯一。',
    ),
  ];
  return {
    proofTimes,
    checks,
    passed: checks.every(({passed}) => passed),
  };
};

const topologySvg = ({scene, world, proofId, inspection}) => {
  const width = 1440;
  const height = 810;
  const colors = {
    far: '#bad7e8',
    mid: '#8ebfae',
    ground: '#b79068',
    near: '#527f69',
  };
  const panels = ['before', 'seam', 'after'];
  const panelWidth = 420;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f7f1df"/>
  <text x="48" y="62" font-family="sans-serif" font-size="30" fill="#25312e">${escapeXml(scene.id)} · ${escapeXml(world.targetId)}</text>
  <text x="48" y="98" font-family="sans-serif" font-size="18" fill="#51615c">provider-free world topology · ${escapeXml(proofId)}</text>
  ${panels.map((phase, panelIndex) => {
    const left = 40 + panelIndex * 466;
    const phaseAt = inspection.proofTimes[phase];
    return `
      <g transform="translate(${left} 145)">
        <rect width="${panelWidth}" height="420" rx="12" fill="#dcebf0" stroke="#6d7f7a" stroke-width="3"/>
        ${(world.strips ?? []).map((strip, index) => {
          const y = 24 + index * 82;
          const offset = Math.round(
            (phaseAt ?? 0) *
            world.distanceViewports *
            (strip.role === 'far' ? world.speedRange.far : world.speedRange.near) *
            42,
          );
          return `
            <rect x="12" y="${y}" width="396" height="66" fill="${colors[strip.role] ?? '#aaaaaa'}" opacity="${0.62 + index * 0.08}"/>
            <path d="M ${20 - offset % 90} ${y + 34} H ${400 - offset % 90}" stroke="#ffffff" stroke-width="4" stroke-dasharray="22 16"/>
            <text x="24" y="${y + 25}" font-family="sans-serif" font-size="15" fill="#20302b">${escapeXml(strip.role)} · ${escapeXml(strip.id)}</text>
          `;
        }).join('')}
        <circle cx="210" cy="205" r="24" fill="#1f5d52" stroke="#ffffff" stroke-width="4"/>
        <text x="210" y="474" text-anchor="middle" font-family="sans-serif" font-size="21" fill="#25312e">${phase} · ${(phaseAt ?? 0).toFixed(2)}</text>
      </g>
    `;
  }).join('')}
  <text x="48" y="650" font-family="sans-serif" font-size="20" fill="#25312e">direction ${escapeXml(world.direction)} · distance ${world.distanceViewports} viewports · ${world.strips.length} semantic strips</text>
  ${inspection.checks.map((item, index) => `
    <text x="${48 + (index % 2) * 690}" y="${692 + Math.floor(index / 2) * 28}" font-family="sans-serif" font-size="16" fill="${item.passed ? '#245f46' : '#a52e2e'}">${item.passed ? 'PASS' : 'FAIL'} · ${escapeXml(item.id)}</text>
  `).join('')}
</svg>`;
};

export const buildWorldTopologyProof = async ({
  root,
  projectSlug,
  storyboard,
  generatedAt = new Date().toISOString(),
}) => {
  const outputDirectory = path.join(
    root,
    'dist',
    projectSlug,
    'world-topology-proof',
  );
  await fs.mkdir(outputDirectory, {recursive: true});
  const worlds = [];
  for (const scene of storyboard.scenes ?? []) {
    for (const world of scene.compositionPlan?.loopingEnvironments ?? []) {
      const proofId = `${scene.id}--${world.targetId}`;
      const inspection = inspectWorldTopologyPlan({scene, world});
      const evidenceFile = path.join(outputDirectory, `${proofId}.svg`);
      await fs.writeFile(
        evidenceFile,
        topologySvg({scene, world, proofId, inspection}),
        'utf8',
      );
      worlds.push({
        proofId,
        sceneId: scene.id,
        groupId: world.targetId,
        fingerprint: worldTopologyProofFingerprint({scene, world}),
        direction: world.direction,
        distanceViewports: world.distanceViewports,
        stripIds: world.strips.map(({id}) => id),
        proofTimes: inspection.proofTimes,
        checks: inspection.checks,
        evidence: path.relative(root, evidenceFile).split(path.sep).join('/'),
        passed: inspection.passed,
      });
    }
  }
  return {
    $schema: '../../schemas/world-topology-proof.schema.json',
    schemaVersion: 1,
    projectSlug,
    storyboardFingerprint: storyboard.directingSummary?.fingerprint,
    generatedAt,
    worlds,
    passed: worlds.every(({passed}) => passed),
  };
};

export const assertWorldTopologyBinding = ({
  request,
  report,
  storyboard,
}) => {
  const binding = request.worldTopologyBinding;
  const world = report?.worlds?.find(
    ({proofId}) => proofId === binding?.proofId,
  );
  const storyboardScene = storyboard?.scenes?.find(
    ({id}) => id === request.compositionBinding?.sceneId,
  );
  const plannedWorld = storyboardScene?.compositionPlan?.loopingEnvironments?.find(
    ({targetId}) => targetId === request.compositionBinding?.nodeId,
  );
  if (
    report?.schemaVersion !== 1 ||
    report.projectSlug !== request.projectSlug ||
    report.passed !== true ||
    report.storyboardFingerprint !== storyboard?.directingSummary?.fingerprint ||
    !world?.passed ||
    !plannedWorld ||
    world.sceneId !== storyboardScene.id ||
    world.groupId !== plannedWorld.targetId ||
    world.fingerprint !== binding?.fingerprint ||
    !world.stripIds.includes(binding?.stripId) ||
    world.fingerprint !==
      worldTopologyProofFingerprint({
        scene: storyboardScene,
        world: plannedWorld,
      })
  ) {
    throw new Error(
      'looping-environment provider request 缺少当前、通过且与 strip/故事板一致的零调用世界拓扑证明。',
    );
  }
  return world;
};
