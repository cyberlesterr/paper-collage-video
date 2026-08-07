import {hashCompositionValue} from './composition-lib.mjs';
import {
  fileExists,
  resolvePublicFile,
} from './project-lib.mjs';
import {defaultSubtitleMaximumCharacters} from './subtitle-lib.mjs';
import {
  normalizeSubtitleSafeArea,
  resolveSubtitleFadeFrames,
  resolveSubtitleLayout,
  resolveSubtitleScenePlacement,
  resolveSubtitleTypography,
} from '../src/subtitleSurface.mjs';

const compactText = (value) => String(value ?? '').replace(/\s/gu, '');

const mergeIntervals = (intervals) => {
  const merged = [];
  for (const interval of [...intervals].sort((left, right) => left.from - right.from)) {
    const previous = merged.at(-1);
    if (previous && interval.from <= previous.to) {
      previous.to = Math.max(previous.to, interval.to);
    } else {
      merged.push({...interval});
    }
  }
  return merged;
};

const coverageForScene = ({scene, fps}) => {
  const narrationFrom = Math.round(scene.narration.startSeconds * fps);
  const narrationTo =
    narrationFrom + Math.max(1, Math.ceil(scene.narration.durationSeconds * fps));
  const intervals = (scene.subtitles ?? [])
    .map((cue) => ({
      from: Math.max(narrationFrom, Math.round(cue.fromSeconds * fps)),
      to: Math.min(narrationTo, Math.round(cue.toSeconds * fps)),
    }))
    .filter(({from, to}) => to > from);
  const coveredFrames = mergeIntervals(intervals).reduce(
    (total, {from, to}) => total + to - from,
    0,
  );
  const narrationFrames = narrationTo - narrationFrom;
  return {
    coveredFrames,
    narrationFrames,
    ratio: narrationFrames === 0 ? 1 : coveredFrames / narrationFrames,
  };
};

const cueDetails = ({scene, fps}) =>
  (scene.subtitles ?? []).map((cue) => {
    const from = Math.round(cue.fromSeconds * fps);
    const to = Math.round(cue.toSeconds * fps);
    return {
      from,
      to,
      text: cue.text,
      fadeFrames: resolveSubtitleFadeFrames({from, to}),
    };
  });

export const createSubtitleContract = async (project) => {
  const fps = project.video.fps;
  const activeProfile = project.editorial?.responsiveProfiles?.find(
    ({id}) => id === project.editorial?.activeProfile,
  );
  const safeArea = normalizeSubtitleSafeArea(activeProfile?.safeArea);
  const layout = resolveSubtitleLayout({
    safeArea,
    width: project.video.width,
    height: project.video.height,
  });
  const fontFile = project.theme?.fontFile ?? null;
  const fontFileExists = fontFile
    ? await fileExists(resolvePublicFile(fontFile))
    : true;
  const renderScale = Math.min(
    project.video.width / 1920,
    project.video.height / 1080,
  );
  const maximumCharactersPerCue =
    defaultSubtitleMaximumCharacters(project.video);
  const scenes = (project.scenes ?? []).map((scene) => {
    const required =
      Boolean(scene.narration?.src) &&
      Number(scene.narration?.durationSeconds) > 0;
    const cues = cueDetails({scene, fps});
    const coverage = coverageForScene({scene, fps});
    const narrationFrom = Math.round(scene.narration.startSeconds * fps);
    const narrationTo =
      narrationFrom + Math.max(1, Math.ceil(scene.narration.durationSeconds * fps));
    const visible = scene.appearance?.subtitles?.variant !== 'hidden';
    const typography = resolveSubtitleTypography({
      appearance: scene.appearance?.subtitles,
      theme: project.theme,
      scale: renderScale,
    });
    const sceneDirecting = (project.editorial?.sceneDirecting ?? []).find(
      (entry) => entry.sceneId === scene.id,
    );
    const scenePlacement = sceneDirecting?.subtitlePlacement ?? null;
    const sceneLayout = resolveSubtitleScenePlacement({
      placement: scenePlacement,
      safeArea,
      maxWidth: scene.appearance?.subtitles?.maxWidth,
      width: project.video.width,
      height: project.video.height,
    });
    const placementConflicts = sceneLayout.conflicts ?? [];
    const placementPassed = placementConflicts.length === 0;
    const cueText = compactText(cues.map(({text}) => text).join(''));
    const narrationText = compactText(scene.narration?.text);
    const narrationTextPresent = narrationText.length > 0;
    const cueCharacterCounts = cues.map(
      ({text}) => [...String(text ?? '').replace(/\s/gu, '')].length,
    );
    const longestCueCharacters = Math.max(0, ...cueCharacterCounts);
    const rangesValid = cues.every(
      ({from, to}) =>
        to > from &&
        from >= narrationFrom - 1 &&
        to <= narrationTo + 1,
    );
    const ordered = cues.every(
      ({from}, index) => index === 0 || from >= cues[index - 1].to,
    );
    const textMatches =
      !required || (narrationTextPresent && cueText === narrationText);
    const coveragePassed = !required || coverage.ratio >= 0.8;
    const passed =
      !required ||
      (
        visible &&
        narrationTextPresent &&
        cues.length > 0 &&
        rangesValid &&
        ordered &&
        textMatches &&
        coveragePassed
      );
    return {
      sceneId: scene.id,
      required,
      visible,
      cueCount: cues.length,
      cueText,
      narrationText,
      narrationTextPresent,
      textMatches,
      rangesValid,
      ordered,
      coverage: {
        ...coverage,
        passed: coveragePassed,
      },
      typography,
      segmentation: {
        maximumCharactersPerCue,
        longestCueCharacters,
        cueCount: cues.length,
        phraseSpacingPresent: cues.some(({text}) => /\s/u.test(text)),
        passed: longestCueCharacters <= maximumCharactersPerCue,
      },
      placement: {
        anchor: sceneLayout.anchor,
        safeArea: sceneLayout.safeArea,
        exclusionZones: (sceneLayout.exclusionZones ?? []).map(
          ({id, role}) => ({id, role}),
        ),
        conflicts: placementConflicts,
        passed: placementPassed,
      },
      cues,
      passed,
    };
  });
  const requiredScenes = scenes.filter(({required}) => required);
  const checks = [
    {
      id: 'subtitle-narration-text',
      passed: requiredScenes.every(({narrationTextPresent}) => narrationTextPresent),
      expected: 'every narration source has non-empty transcript text',
      actual: `${requiredScenes.filter(({narrationTextPresent}) => narrationTextPresent).length}/${requiredScenes.length} narrated scenes`,
    },
    {
      id: 'subtitle-cues-present',
      passed: requiredScenes.every(({visible, cueCount}) => visible && cueCount > 0),
      expected: 'every narrated scene has visible subtitle cues',
      actual: `${requiredScenes.filter(({visible, cueCount}) => visible && cueCount > 0).length}/${requiredScenes.length} narrated scenes`,
    },
    {
      id: 'subtitle-transcript-match',
      passed: requiredScenes.every(({textMatches}) => textMatches),
      expected: 'subtitle text matches narration text after whitespace normalization',
      actual: `${requiredScenes.filter(({textMatches}) => textMatches).length}/${requiredScenes.length} narrated scenes`,
    },
    {
      id: 'subtitle-narration-coverage',
      passed: requiredScenes.every(
        ({rangesValid, ordered, coverage}) =>
          rangesValid && ordered && coverage.passed,
      ),
      expected: 'ordered cues stay in narration window and cover at least 80%',
      actual: requiredScenes.map(({sceneId, coverage}) => ({
        sceneId,
        ratio: Number(coverage.ratio.toFixed(4)),
      })),
    },
    {
      id: 'subtitle-safe-area',
      passed: layout.contract === 'responsive-safe-area-v1',
      expected: 'responsive-safe-area-v1',
      actual: {
        profile: activeProfile?.id ?? 'fallback',
        safeArea,
        maxWidth: layout.maxWidth,
      },
    },
    {
      id: 'subtitle-scene-placement',
      passed: requiredScenes.every(({placement}) => placement.passed),
      expected: 'every narrated scene resolves subtitles without unresolved exclusion conflicts',
      actual: requiredScenes.map(({sceneId, placement}) => ({
        sceneId,
        anchor: placement.anchor,
        conflicts: placement.conflicts,
      })),
    },
    {
      id: 'subtitle-font-source',
      passed: fontFileExists,
      expected: fontFile ? 'declared font file exists' : 'runtime fallback stack',
      actual: {
        fontFile,
        families: [
          ...new Set(requiredScenes.map(({typography}) => typography.fontFamily)),
        ],
      },
    },
    {
      id: 'subtitle-typography-surface',
      passed: requiredScenes.every(
        ({typography}) => typography.contract === 'subtitle-typography-v1',
      ),
      expected: 'subtitle-typography-v1 resolved for every narrated scene',
      actual: requiredScenes.map(({sceneId, typography}) => ({
        sceneId,
        fontFamily: typography.fontFamily,
        fontWeight: typography.fontWeight,
        edgeTreatment: typography.edgeTreatment,
      })),
    },
    {
      id: 'subtitle-segmentation-surface',
      passed: requiredScenes.every(({segmentation}) => segmentation.passed),
      expected: `every encoded cue uses at most ${maximumCharactersPerCue} non-space characters`,
      actual: requiredScenes.map(({sceneId, segmentation}) => ({
        sceneId,
        maximumCharactersPerCue: segmentation.maximumCharactersPerCue,
        longestCueCharacters: segmentation.longestCueCharacters,
        cueCount: segmentation.cueCount,
        phraseSpacingPresent: segmentation.phraseSpacingPresent,
      })),
    },
  ];
  const fingerprint = hashCompositionValue({
    contract: 'subtitle-surface-v1',
    video: project.video,
    safeArea,
    layout,
    font: {
      file: fontFile,
      family: project.theme?.fontFamily ?? null,
      fileExists: fontFileExists,
      sceneTypography: scenes.map(({sceneId, typography}) => ({
        sceneId,
        typography,
      })),
    },
    scenes,
  });
  return {
    schemaVersion: 1,
    contract: 'subtitle-surface-v1',
    passed:
      scenes.every(({passed}) => passed) &&
      checks.every(({passed}) => passed),
    fingerprint,
    summary: {
      totalScenes: scenes.length,
      requiredScenes: requiredScenes.length,
      passedScenes: requiredScenes.filter(({passed}) => passed).length,
    },
    layout,
    font: {
      file: fontFile,
      family: project.theme?.fontFamily ?? null,
      source: fontFile ? 'project-file' : 'runtime-fallback',
      exists: fontFileExists,
      sceneTypography: scenes.map(({sceneId, typography}) => ({
        sceneId,
        typography,
      })),
    },
    scenes,
    checks,
  };
};

export const deriveSubtitleProofSamples = ({
  project,
  timeline,
  contract,
}) =>
  contract.scenes
    .filter(({required, passed, cueCount}) => required && passed && cueCount > 0)
    .map((sceneContract) => {
      const scene = (project.scenes ?? []).find(
        ({id}) => id === sceneContract.sceneId,
      );
      const timelineScene = (timeline.scenes ?? []).find(
        ({id}) => id === sceneContract.sceneId,
      );
      const cue = scene?.subtitles?.[0];
      if (!scene || !timelineScene || !cue) return null;
      const localFrame = Math.max(
        0,
        Math.round(((cue.fromSeconds + cue.toSeconds) / 2) * project.video.fps),
      );
      const absoluteFrame = timelineScene.from + localFrame;
      return {
        sceneId: scene.id,
        cueText: cue.text,
        frame: absoluteFrame,
        time: absoluteFrame / project.video.fps,
        label: `${scene.id} · ${[...cue.text].slice(0, 16).join('')}`,
      };
    })
    .filter(Boolean);
