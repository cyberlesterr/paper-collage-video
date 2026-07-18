const punctuationPause = (text) => {
  if (/[。！？!?]$/.test(text)) return 1.8;
  if (/[，、；：,;:]$/.test(text)) return 0.8;
  return 0;
};

const splitLongSegment = (segment, maximumCharacters) => {
  if ([...segment].length <= maximumCharacters) return [segment];
  const pieces = segment
    .split(/(?<=[，、；：,;:])/u)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const output = [];
  for (const piece of pieces.length > 1 ? pieces : [segment]) {
    const characters = [...piece];
    while (characters.length > maximumCharacters) {
      output.push(characters.splice(0, maximumCharacters).join(''));
    }
    if (characters.length) output.push(characters.join(''));
  }
  return output;
};

export const segmentSubtitleText = (text, maximumCharacters) =>
  String(text ?? '')
    .split(/(?<=[。！？!?])/u)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .flatMap((segment) => splitLongSegment(segment, maximumCharacters));

export const deriveSubtitleCues = ({
  text,
  startFrame,
  durationSeconds,
  fps,
  maximumCharacters,
  gapFrames = 2,
}) => {
  const rawSegments = segmentSubtitleText(text, maximumCharacters);
  if (rawSegments.length === 0) return [];
  const narrationFrames = Math.max(1, Math.ceil(durationSeconds * fps));
  const segmentCount = Math.min(rawSegments.length, narrationFrames);
  const segments = Array.from({length: segmentCount}, (_, index) => {
    const from = Math.floor((index * rawSegments.length) / segmentCount);
    const to = Math.floor(((index + 1) * rawSegments.length) / segmentCount);
    return rawSegments.slice(from, to).join('');
  });
  const effectiveGapFrames =
    segments.length <= 1
      ? 0
      : Math.min(
          gapFrames,
          Math.max(
            0,
            Math.floor(
              (narrationFrames - segments.length) / (segments.length - 1),
            ),
          ),
        );
  const totalGapFrames = effectiveGapFrames * Math.max(0, segments.length - 1);
  const availableFrames = Math.max(1, narrationFrames - totalGapFrames);
  const weights = segments.map(
    (segment) => Math.max(1, [...segment.replace(/\s/g, '')].length + punctuationPause(segment)),
  );
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  let cursor = startFrame;
  let allocated = 0;
  return segments.map((segment, index) => {
    const isLast = index === segments.length - 1;
    const remainingAfter = segments.length - index - 1;
    const frames = isLast
      ? availableFrames - allocated
      : Math.min(
          availableFrames - allocated - remainingAfter,
          Math.max(1, Math.round((availableFrames * weights[index]) / totalWeight)),
        );
    const from = cursor;
    const to = isLast
      ? startFrame + narrationFrames
      : Math.min(startFrame + narrationFrames, from + frames);
    allocated += to - from;
    cursor = to + (isLast ? 0 : effectiveGapFrames);
    return {from, to, text: segment};
  });
};

export const cuesFromTiming = ({timing, startFrame, fps}) =>
  timing.map((cue) => ({
    from: startFrame + Math.max(0, Math.round(cue.startSeconds * fps)),
    to: startFrame + Math.max(1, Math.round(cue.endSeconds * fps)),
    text: cue.text,
  }));
