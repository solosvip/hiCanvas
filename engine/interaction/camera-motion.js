// Black-box #85, 2026-11-25: 8 native hand moves at ~16ms, release and 90 rAFs.
// Velocity log-fit: 0.91002 per 16⅔ms, tau 176.76ms; release velocity ~0.5 of
// the last pointer velocity. Measured drift ~59.84px for an 80px/8-frame drag.
const decayRate = -Math.log(.91) / (1000 / 60)
export function createCameraMotion({ read, change, reduceMotion }) {
  let animation = null, velocity = null, time = 0
  function stop() { animation = velocity = null; change({ needsFrame: false }) }
  return {
    stop,
    animate(target, now) {
      stop()
      if (!target) return
      if (reduceMotion) { change({ camera: target }); return }
      animation = { from: read().camera, to: target, start: now, duration: 220 }
      time = now; change({ needsFrame: true })
    },
    slide(value, now) {
      stop(); if (reduceMotion || Math.hypot(value.x, value.y) < .01) return
      velocity = value; time = now; change({ needsFrame: true })
    },
    tick(now) {
      if (animation) {
        const { from, to, start, duration } = animation, progress = Math.min(1, (now - start) / duration), ease = 1 - (1 - progress) ** 3
        const z = 1 / (1 / from.z + (1 / to.z - 1 / from.z) * ease)
        // Interpolate visible canvas centers and reciprocal scale together.
        const camera = { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease, z }
        if (progress === 1) animation = null
        change({ camera, needsFrame: Boolean(animation) }); return
      }
      if (velocity) {
        const dt = Math.max(0, now - time), factor = Math.exp(-decayRate * dt), travel = (1 - factor) / decayRate
        time = now
        const camera = read().camera
        change({ camera: { ...camera, x: camera.x + velocity.x * travel / camera.z, y: camera.y + velocity.y * travel / camera.z } })
        velocity = { x: velocity.x * factor, y: velocity.y * factor }
        if (Math.hypot(velocity.x, velocity.y) < .01) velocity = null
        change({ needsFrame: Boolean(velocity) })
      }
    },
    active: () => Boolean(animation || velocity),
  }
}
