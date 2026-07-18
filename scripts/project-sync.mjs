#!/usr/bin/env node
import {
  loadProject,
  probeMedia,
  resolveRenderConcurrency,
  resolvePublicFile,
  writeJson,
} from './project-lib.mjs';

const slug = process.argv[2];

try {
  const {paths, project} = await loadProject(slug);
  const scenes = project.scenes ?? [];
  const results = new Array(scenes.length);
  const concurrency = Math.min(resolveRenderConcurrency(), scenes.length);
  await Promise.all(
    Array.from({length: concurrency}, async (_, workerIndex) => {
      for (let index = workerIndex; index < scenes.length; index += concurrency) {
        const scene = scenes[index];
        const media = await probeMedia(resolvePublicFile(scene.narration.src));
        const durationSeconds = Number(media.format?.duration ?? 0);
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
          throw new Error(`无法读取旁白时长：${scene.narration.src}`);
        }
        if (Math.abs(scene.narration.durationSeconds - durationSeconds) <= 0.0005) {
          results[index] = null;
          continue;
        }
        results[index] = `${scene.id}: ${scene.narration.durationSeconds}s → ${durationSeconds}s`;
        scene.narration.durationSeconds = durationSeconds;
      }
    }),
  );
  const updates = results.filter(Boolean);
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
