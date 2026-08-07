const DEFAULT_SAFE_AREA = {
  x: 0.06,
  y: 0.06,
  width: 0.88,
  height: 0.88,
};

const finiteOr = (value, fallback) =>
  Number.isFinite(value) ? Number(value) : fallback;

const DEFAULT_FONT_STACK = 'STKaiti, KaiTi, "Noto Serif SC", serif';

export const resolveSubtitleTypography = ({
  appearance,
  theme,
  scale = 1,
}) => {
  const edgeTreatment = appearance?.edgeTreatment ?? 'soft-shadow';
  const fontFamily = appearance?.fontFamily?.trim() || (
    theme?.fontFile
      ? 'PaperCollageProjectFont, serif'
      : (theme?.fontFamily ?? DEFAULT_FONT_STACK)
  );
  const fontWeight = Number.isInteger(appearance?.fontWeight)
    ? appearance.fontWeight
    : 700;
  const outline = Math.max(0.5, scale);
  const textShadow = edgeTreatment === 'none'
    ? 'none'
    : edgeTreatment === 'crisp-outline'
      ? [
          `${outline}px 0 0 rgba(28,15,10,.82)`,
          `${-outline}px 0 0 rgba(28,15,10,.82)`,
          `0 ${outline}px 0 rgba(28,15,10,.82)`,
          `0 ${-outline}px 0 rgba(28,15,10,.82)`,
        ].join(', ')
      : appearance?.variant === 'plain'
        ? '0 2px 8px rgba(0,0,0,.72)'
        : '0 3px 2px rgba(28,15,10,.9), 0 0 14px rgba(28,15,10,.78)';
  return {
    contract: 'subtitle-typography-v1',
    fontFamily,
    fontWeight,
    edgeTreatment,
    textShadow,
  };
};

export const normalizeSubtitleSafeArea = (safeArea) => {
  const resolved = {
    x: finiteOr(safeArea?.x, DEFAULT_SAFE_AREA.x),
    y: finiteOr(safeArea?.y, DEFAULT_SAFE_AREA.y),
    width: finiteOr(safeArea?.width, DEFAULT_SAFE_AREA.width),
    height: finiteOr(safeArea?.height, DEFAULT_SAFE_AREA.height),
  };
  const valid =
    resolved.x >= 0 &&
    resolved.y >= 0 &&
    resolved.width > 0 &&
    resolved.height > 0 &&
    resolved.x + resolved.width <= 1 &&
    resolved.y + resolved.height <= 1;
  return valid ? resolved : DEFAULT_SAFE_AREA;
};

export const resolveSubtitleFadeFrames = ({
  from,
  to,
  maximumFadeFrames = 6,
}) => {
  const duration = Math.max(0, Math.round(to) - Math.round(from));
  if (duration < 3) return 0;
  return Math.min(
    Math.max(0, Math.floor(maximumFadeFrames)),
    Math.floor((duration - 1) / 2),
  );
};

export const resolveSubtitleLayout = ({
  safeArea,
  maxWidth = 0.78,
  width,
  height,
}) => {
  const resolvedSafeArea = normalizeSubtitleSafeArea(safeArea);
  const boundedMaxWidth = Math.min(
    resolvedSafeArea.width,
    Math.max(0.1, finiteOr(maxWidth, 0.78)),
  );
  const centeredX = (1 - boundedMaxWidth) / 2;
  const left = Math.max(resolvedSafeArea.x, centeredX);
  const right = Math.max(
    1 - resolvedSafeArea.x - resolvedSafeArea.width,
    centeredX,
  );
  const scale = Math.min(width / 1920, height / 1080);
  const safeBottom = Math.max(
    0,
    (1 - resolvedSafeArea.y - resolvedSafeArea.height) * height,
  );
  return {
    contract: 'responsive-safe-area-v1',
    safeArea: resolvedSafeArea,
    leftPercent: left * 100,
    rightPercent: right * 100,
    bottomPixels: safeBottom + 12 * scale,
    maxWidth: boundedMaxWidth,
  };
};

const normalizedZoneRect = (zone) => ({
  left: Number(zone?.x ?? 0),
  top: Number(zone?.y ?? 0),
  right: Number(zone?.x ?? 0) + Number(zone?.width ?? 0),
  bottom: Number(zone?.y ?? 0) + Number(zone?.height ?? 0),
});

const normalizeRect = (rect) => ({
  left: Number(rect?.left ?? 0),
  top: Number(rect?.top ?? 0),
  right: Number(rect?.right ?? (rect?.left ?? 0) + (rect?.width ?? 0)),
  bottom: Number(rect?.bottom ?? (rect?.top ?? 0) + (rect?.height ?? 0)),
});

export const rectanglesOverlap = (left, right, padding = 0) => {
  const a = normalizeRect(left);
  const b = normalizeRect(right);
  return (
    a.left - padding < b.right + padding &&
    a.right + padding > b.left - padding &&
    a.top - padding < b.bottom + padding &&
    a.bottom + padding > b.top - padding
  );
};

export const resolveSubtitleScenePlacement = ({
  placement = null,
  safeArea,
  maxWidth = 0.78,
  width,
  height,
}) => {
  const fallbackSafeArea = normalizeSubtitleSafeArea(safeArea);
  const sceneSafeArea = placement?.safeArea
    ? normalizeSubtitleSafeArea(placement.safeArea)
    : fallbackSafeArea;
  const anchor = placement?.anchor ?? 'bottom';
  const topAnchored = ['top', 'top-left', 'top-right'].includes(anchor);
  const exclusionZones = (placement?.exclusionZones ?? [])
    .filter(
      (zone) =>
        zone &&
        zone.role !== 'subtitle' &&
        Number(zone?.width) > 0 &&
        Number(zone?.height) > 0,
    )
    .map((zone) => ({
      id: zone.id,
      role: zone.role,
      padding: Number(zone?.padding ?? 0),
      ...normalizedZoneRect(zone),
    }));
  const boundedMaxWidth = Math.min(
    sceneSafeArea.width,
    Math.max(0.1, finiteOr(maxWidth, 0.78)),
  );
  const scale = Math.min(width / 1920, height / 1080);
  const lineHeight = 42 * scale * 1.35;
  const paddingY = 12 * scale;
  const boxHeightNorm = Math.min(1, (lineHeight + paddingY * 2) / height);
  const centeredX = (1 - boundedMaxWidth) / 2;
  const leftPercent = Math.max(sceneSafeArea.x, centeredX) * 100;
  const rightPercent =
    Math.max(1 - sceneSafeArea.x - sceneSafeArea.width, centeredX) * 100;
  const baseY = () =>
    topAnchored
      ? sceneSafeArea.y
      : anchor === 'center'
        ? (1 - boxHeightNorm) / 2
        : sceneSafeArea.y + sceneSafeArea.height - boxHeightNorm;
  let box = {
    left: Math.max(sceneSafeArea.x, centeredX),
    top: baseY(),
    width: boundedMaxWidth,
    height: boxHeightNorm,
  };
  const conflicts = [];
  let progress = true;
  while (progress) {
    const overlapping = exclusionZones.filter((zone) =>
      rectanglesOverlap(box, zone, zone.padding),
    );
    if (overlapping.length === 0) break;
    progress = false;
    const zone = overlapping[0];
    if (topAnchored) {
      const candidate = {
        ...box,
        top: zone.bottom + 0.01,
      };
      if (
        candidate.top + box.height <= sceneSafeArea.y + sceneSafeArea.height &&
        candidate.top > box.top
      ) {
        box = candidate;
        progress = true;
      }
    } else {
      const candidate = {
        ...box,
        top: zone.top - box.height - 0.01,
      };
      if (
        candidate.top >= sceneSafeArea.y &&
        candidate.top < box.top
      ) {
        box = candidate;
        progress = true;
      }
    }
    if (!progress) {
      conflicts.push({zoneId: zone.id, role: zone.role});
      break;
    }
  }
  const safeBottom = (1 - box.top - box.height) * height;
  return {
    contract: 'scene-subtitle-placement-v1',
    safeArea: sceneSafeArea,
    anchor,
    leftPercent,
    rightPercent,
    bottomPixels: Math.max(0, safeBottom) + 12 * scale,
    topPixels: box.top * height,
    maxWidth: boundedMaxWidth,
    box,
    exclusionZones,
    conflicts,
  };
};
