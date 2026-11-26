import { createNoteSnapping } from './note-snapping.js';
import { createObjectSnapping } from './object-snapping.js';
import { snapConnectionPoint } from './control-point-snap.js';
function checkedPreferences(patch, previous) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.entries(patch).some(([key, value]) => !['enabled', 'controlPoints'].includes(key) || typeof value !== 'boolean')) throw new Error('吸附偏好需要已登记的布尔选项。');
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
    clear,
    describe: () => [...(guides ? [guides] : []), ...(notes.indicator() ? [notes.indicator()] : []), ...(pointIndicator ? [pointIndicator] : [])],
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
      if (preferences.enabled === Boolean(input[context.snapModifier === 'meta' ? 'metaKey' : 'ctrlKey'])) return point;
      const result = objects.resize(ids, frame, handle, start, point, options);
      guides = guideDescription(result.lines);
      return result.point;
    },
    move(starts, delta, input) {
      clear();
      const noted = notes.preview(starts, delta);
      if (notes.indicator()) return noted;
      if (preferences.enabled === Boolean(input[context.snapModifier === 'meta' ? 'metaKey' : 'ctrlKey'])) return delta;
      const result = objects.move(starts, delta, input);
      guides = guideDescription(result.lines);
      return result.delta;
    }
  };
}
