#!/usr/bin/env node
import {parseCliValue} from './contract-utils.mjs';
import {
  cuesFromTiming,
  defaultSubtitleMaximumCharacters,
  deriveSubtitleCues,
  ensureVisibleNarrationSubtitles,
} from './subtitle-lib.mjs';
import {
  loadProject,
  readJson,
  resolvePublicFile,
  writeJson,
} from './project-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const valueFor = (name) => parseCliValue(args, name);

try {
  if (!slug) {
    throw new Error('用法：project:subtitles -- <slug> [--max-chars=<count>] [--gap-seconds=<seconds>]');
  }
  const {paths, project} = await loadProject(slug);
  const maximumCharacters = Number(
    valueFor('--max-chars') ??
      defaultSubtitleMaximumCharacters(project.video),
  );
  const gapSeconds = Number(valueFor('--gap-seconds') ?? 2 / project.video.fps);
  if (!Number.isInteger(maximumCharacters) || maximumCharacters < 4) {
    throw new Error('--max-chars 必须是至少 4 的整数。');
  }
  if (!Number.isFinite(gapSeconds) || gapSeconds < 0) {
    throw new Error('--gap-seconds 必须是非负秒数。');
  }

  let restoredVisibility = 0;
  for (const scene of project.scenes ?? []) {
    if (scene.narration.timingSrc) {
      const timing = await readJson(resolvePublicFile(scene.narration.timingSrc));
      if (!Array.isArray(timing?.cues)) {
        throw new Error(`${scene.narration.timingSrc} 缺少 cues 数组。`);
      }
      scene.subtitles = cuesFromTiming({
        timing: timing.cues,
        startSeconds: scene.narration.startSeconds,
      });
    } else {
      scene.subtitles = deriveSubtitleCues({
        text: scene.narration.text,
        startSeconds: scene.narration.startSeconds,
        durationSeconds: scene.narration.durationSeconds,
        fps: project.video.fps,
        maximumCharacters,
        gapSeconds,
      });
    }
    if (ensureVisibleNarrationSubtitles(scene)) restoredVisibility += 1;
  }
  await writeJson(paths.projectFile, project);
  console.log(`✓ 已为 ${project.scenes.length} 个镜头同步字幕时间`);
  if (restoredVisibility > 0) {
    console.log(
      `✓ 已把 ${restoredVisibility} 个有旁白镜头从隐藏字幕恢复为 boxed + crisp-outline`,
    );
  }
} catch (error) {
  console.error(`project:subtitles failed: ${error.message}`);
  process.exitCode = 1;
}
