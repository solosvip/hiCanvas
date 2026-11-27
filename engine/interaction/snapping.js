import { createNoteSnapping } from './note-snapping.js';
import { createObjectSnapping } from './object-snapping.js';
import { snapConnectionPoint } from './control-point-snap.js';
import { gridDescription, gridMove, gridPoint } from './grid-snapping.js';
import { snapResize } from './resize-snapping.js';
function checkedPreferences(patch, previous) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.entries(patch).some(([key, value]) => !['enabled', 'controlPoints', 'grid'].includes(key) || typeof value !== 'boolean')) throw new Error('吸附偏好需要已登记的布尔选项。');
  return Object.freeze({
    ...previous,
    ...patch
  });
}
const immutablePoint = p => Object.freeze({
  ...p
});
const guideDescription = lines => lines.length ? Object.freeze({
  kind: 'snap-guides',
  bounds: Object.freeze({
    x: 0,
    y: 0,
    w: 0,
    h: 0
  }),
  lines: Object.freeze(lines.map(line => Object.freeze({
    ...line,
    start: immutablePoint(line.start),
    end: immutablePoint(line.end),
    points: Object.freeze(line.points.map(immutablePoint)),
    ticks: Object.freeze((line.ticks || []).map(immutablePoint))
  })))
}) : null;

// Host preferences belong to this interaction session, never to the Store.
export function createSnapping(context, options) {
  // The host chooses its primary modifier; the pure engine never sniffs an OS.
  // macOS native samples invert bounds with Command, while Control continues
  // to own the existing connection policy and must not change note drags.
  if (!['meta', 'control'].includes(context.snapModifier)) throw new Error('吸附修饰键需要 meta 或 control。');
  let preferences = checkedPreferences(options, {
    enabled: false,
    grid: false,
    controlPoints: context.controlPointSnapping
  });
  const notes = createNoteSnapping(context),
    objects = createObjectSnapping(context);
  let guides = null,
    pointIndicator = null;
  const clear = () => {
    guides = null;
    pointIndicator = null;
    notes.clear();
  };
  return {
    preferences: () => preferences,
    setPreferences(patch) {
      preferences = checkedPreferences(patch, preferences);
    },
    nudge(delta, largeStep = false) {
      const factor = preferences.grid ? largeStep ? 5 : 10 : 1;
      return { x: delta.x * factor, y: delta.y * factor };
    },
    clear,
    describe: () => [...(preferences.grid ? [gridDescription] : []), ...(guides ? [guides] : []), ...(notes.indicator() ? [notes.indicator()] : []), ...(pointIndicator ? [pointIndicator] : [])],
    controlPoint(shape, point, excluded, input, movingId) {
      clear();
      const result = snapConnectionPoint({
        ...context,
        controlPointSnapping: preferences.controlPoints
      }, shape, point, excluded, input, movingId);
      pointIndicator = result.indicator;
      return result.point;
    },
    resize(ids, frame, handle, start, point, options, input) {
      clear();
      const modifier = Boolean(input[context.snapModifier === 'meta' ? 'metaKey' : 'ctrlKey']);
      const objectEnabled = preferences.enabled !== modifier, gridEnabled = preferences.grid && !modifier;
      if (!objectEnabled && !gridEnabled) return point;
      const proposed = gridEnabled ? gridPoint(point) : point;
      if (!objectEnabled) return proposed;
      const result = snapResize(frame, handle, start, proposed, options, original => objects.resizeTargets(ids, original.box));
      guides = guideDescription(objects.resizeLines(result));
      return result.point;
    },
    move(starts, delta, input) {
      clear();
      const noted = notes.preview(starts, delta);
      if (notes.indicator()) return noted;
      const modifier = Boolean(input[context.snapModifier === 'meta' ? 'metaKey' : 'ctrlKey']);
      // Native legacy control: raw309 -> object303 even though grid310 is
      // closer; grid alone ->310. Preserve an exactly aligned (zero delta) axis.
      const grid = preferences.grid && !modifier ? gridMove(starts, delta, input) : delta;
      const result = preferences.enabled !== modifier ? objects.move(starts, delta, input, grid) : { delta: grid, lines: [] };
      guides = guideDescription(result.lines);
      return result.delta;
    }
  };
}
