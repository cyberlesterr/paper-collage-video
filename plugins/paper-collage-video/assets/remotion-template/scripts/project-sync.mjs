#!/usr/bin/env node
import {
  loadProject,
  probeMedia,
  resolvePublicFile,
  writeJson,
} from './project-lib.mjs';

const slug = process.argv[2];

try {
  const {paths, project} = await loadProject(slug);
  const updates = [];
  for (const scene of project.scenes ?? []) {
    const media = await probeMedia(resolvePublicFile(scene.narration.src));
    const durationSeconds = Number(media.format?.duration ?? 0);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error(`无法读取旁白时长：${scene.narration.src}`);
    }
    if (Math.abs(scene.narration.durationSeconds - durationSeconds) > 0.0005) {
      updates.push(
        `${scene.id}: ${scene.narration.durationSeconds}s → ${durationSeconds}s`,
      );
      scene.narration.durationSeconds = durationSeconds;
    }
  }
  if (updates.length > 0) {
    await writeJson(paths.projectFile, project);
    console.log(`✓ 已同步 ${updates.length} 段旁白时长`);
    for (const update of updates) console.log(`  ${update}`);
  } else {
    console.log('✓ 旁白时长已经同步');
  }
} catch (error) {
  console.error(`project:sync failed: ${error.message}`);
  process.exitCode = 1;
}
