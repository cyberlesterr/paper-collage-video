export type SubtitleSafeArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function normalizeSubtitleSafeArea(
  safeArea?: Partial<SubtitleSafeArea> | null,
): SubtitleSafeArea;

export function resolveSubtitleFadeFrames(options: {
  from: number;
  to: number;
  maximumFadeFrames?: number;
}): number;

export function resolveSubtitleLayout(options: {
  safeArea?: Partial<SubtitleSafeArea> | null;
  maxWidth?: number;
  width: number;
  height: number;
}): {
  contract: 'responsive-safe-area-v1';
  safeArea: SubtitleSafeArea;
  leftPercent: number;
  rightPercent: number;
  bottomPixels: number;
  maxWidth: number;
};

export type SubtitleExclusionZone = {
  id: string;
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
  padding?: number;
};

export function rectanglesOverlap(
  left: {left: number; top: number; width: number; height: number},
  right: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  },
  padding?: number,
): boolean;

export function resolveSubtitleScenePlacement(options: {
  placement?: {
    anchor?: string;
    safeArea?: Partial<SubtitleSafeArea> | null;
    exclusionZones?: SubtitleExclusionZone[];
  } | null;
  safeArea?: Partial<SubtitleSafeArea> | null;
  maxWidth?: number;
  width: number;
  height: number;
}): {
  contract: 'scene-subtitle-placement-v1';
  safeArea: SubtitleSafeArea;
  anchor: string;
  leftPercent: number;
  rightPercent: number;
  bottomPixels: number;
  topPixels: number;
  maxWidth: number;
  box: {left: number; top: number; width: number; height: number};
  exclusionZones: Array<{
    id: string;
    role: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
    padding: number;
  }>;
  conflicts: Array<{zoneId: string; role: string}>;
};

export function resolveSubtitleTypography(options: {
  appearance?: {
    variant?: 'boxed' | 'plain' | 'hidden';
    fontFamily?: string;
    fontWeight?: number;
    edgeTreatment?: 'soft-shadow' | 'crisp-outline' | 'none';
  } | null;
  theme?: {
    fontFile?: string;
    fontFamily?: string;
  } | null;
  scale?: number;
}): {
  contract: 'subtitle-typography-v1';
  fontFamily: string;
  fontWeight: number;
  edgeTreatment: 'soft-shadow' | 'crisp-outline' | 'none';
  textShadow: string;
};
