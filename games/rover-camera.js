import * as T from 'three';
/*
 * Camera rig for the rover/kitchen game.
 *
 * The rig orbits the current focus point (the chef, the rover or the kitchen
 * station) and always aims at it. Controls, in player terms:
 *
 *  - hold the right mouse button and move the mouse: the view turns the same
 *    way the mouse goes (right → right, up → up). Release the button and the
 *    rotation stops at once — no inertia, no stuck drag;
 *  - the left mouse button keeps doing game actions (a click without movement
 *    is a tap); a real left-button drag also turns the view, so nobody has to
 *    guess which button works;
 *  - the wheel zooms in and out, two fingers twist/pinch/pan on touch screens,
 *    the middle button pans;
 *  - vertical gaze is clamped, so the camera never flips over the focus point.
 *
 * Everything that moves the view is tracked on `window`, not only on the
 * canvas. That matters more than it sounds: `setPointerCapture` throws
 * `InvalidStateError` as soon as the pointer is no longer active (touch that
 * was released, pointer captured by another document, element already removed
 * from the DOM, an iframe that lost the pointer). The old rig called it
 * unguarded inside `pointerdown`, so a single unlucky press aborted the whole
 * game. Now the capture is only a bonus (it keeps the events coming when the
 * cursor leaves the canvas) and is always guarded; the real drag state lives
 * here and is dropped on pointerup / pointercancel / window blur / hidden tab /
 * fullscreen change.
 *
 * Everything else (collision boom, terrain limits, per-context presets) keeps
 * working as before.
 */
const ORBIT_SPEED = .005;
const TILT_SPEED = .0048;
const WHEEL_STEP = .0015;
const TAP_SLOP = 4;

export class RoverCamera {
  constructor({element, worldCamera, kitchenCamera, focus, terrain, solids, enabled, tap}) {
    Object.assign(this, {element, worldCamera, kitchenCamera, focus, terrain, solids, enabled, tap});
    this.pointers = new Map();
    this.two = null;
    this.context = null;
    this.anchor = new T.Vector3();
    this.desired = new T.Vector3();
    this.direction = new T.Vector3();
    this.activeCamera = worldCamera;
    /* Захват указателя больше не используется: состояние драга живёт здесь,
       а слушатели висят на window. Поле оставлено для снапшотов и отладки. */
    this.locked = false;
    this.states = {
      foot: this.makeState(5.7, -.34),
      vehicle: this.makeState(11, -.34),
      kitchen: this.makeState(2.95, -.46)
    };
    this.bind(element);
  }
  bind(element) {
    if (element && typeof element.addEventListener === 'function') {
      element.addEventListener('contextmenu', (e) => e.preventDefault());
      element.addEventListener('pointerdown', (e) => this.down(e));
      element.addEventListener('wheel', (e) => this.wheel(e), {passive: false});
      element.addEventListener('dragstart', (e) => e.preventDefault());
    }
    /* Драг слушаем на window: он продолжается, даже когда курсор ушёл за
       пределы канваса, и не зависит от того, удался ли захват указателя. */
    const win = typeof window !== 'undefined' ? window : null;
    this.win = win;
    if (!win || typeof win.addEventListener !== 'function') return;
    win.addEventListener('pointermove', (e) => this.move(e), {passive: false});
    win.addEventListener('pointerup', (e) => this.up(e));
    win.addEventListener('pointercancel', (e) => this.cancel(e));
    win.addEventListener('blur', () => this.clear());
    win.addEventListener('contextmenu', (e) => { if (this.pointers.size) e.preventDefault(); });
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
      document.addEventListener('fullscreenchange', () => this.clear());
      document.addEventListener('webkitfullscreenchange', () => this.clear());
    }
  }
  makeState(distance, pitch) {
    return {yaw: 0, pitch, distance, pan: new T.Vector3(), cyaw: 0, cpitch: pitch, cdistance: distance, cpan: new T.Vector3()};
  }
  state() { return this.states[this.focus().context]; }
  limits() {
    const c = this.focus().context;
    return c === 'kitchen'
      ? {min: 1.15, max: 5.2, pan: 1.05, minPitch: -1.30, maxPitch: .83}
      : c === 'vehicle'
        ? {min: 4.5, max: 20, pan: 6, minPitch: -1.30, maxPitch: 1.30}
        : {min: 2.7, max: 12, pan: 3, minPitch: -1.30, maxPitch: 1.30};
  }
  clamp(s) {
    const l = this.limits();
    s.distance = T.MathUtils.clamp(s.distance, l.min, l.max);
    s.pitch = T.MathUtils.clamp(s.pitch, l.minPitch, l.maxPitch);
    const length = Math.hypot(s.pan.x, s.pan.z);
    if (length > l.pan) { s.pan.x *= l.pan / length; s.pan.z *= l.pan / length; }
    s.pan.y = T.MathUtils.clamp(s.pan.y, -.4, this.focus().context === 'kitchen' ? .65 : 1.6);
  }
  /* Захват указателя — необязательный бонус. Любая ошибка здесь (а браузер
     бросает InvalidStateError, если указатель уже отпущен) не должна всплывать
     в window.onerror: игра продолжает работать через слушатели window. */
  capture(id) {
    const el = this.element;
    if (!el || typeof el.setPointerCapture !== 'function' || id == null) return false;
    try {
      if (el.isConnected === false) return false;
      if (typeof el.hasPointerCapture === 'function' && el.hasPointerCapture(id)) return true;
      el.setPointerCapture(id);
      return true;
    } catch (err) {
      return false;
    }
  }
  release(id) {
    const el = this.element;
    if (!el || typeof el.releasePointerCapture !== 'function' || id == null) return;
    try {
      if (typeof el.hasPointerCapture !== 'function' || el.hasPointerCapture(id)) el.releasePointerCapture(id);
    } catch (err) {}
  }
  down(e) {
    if (!this.enabled() || (e.button != null && e.button > 2)) return;
    const pointerId = e.pointerId == null ? 1 : e.pointerId;
    const type = e.pointerType || 'mouse';
    const button = e.button || 0;
    if (this.pointers.has(pointerId)) return;      // повторный pointerdown того же указателя
    if (typeof e.preventDefault === 'function') e.preventDefault();
    /* ПКМ — основной режим камеры, тач/перо — тоже сразу. ЛКМ остаётся
       игровым кликом: она начнёт вращать только после заметного движения. */
    this.pointers.set(pointerId, {x: e.clientX, y: e.clientY, button, type, moved: 0, orbit: type !== 'mouse' || button === 2});
    this.capture(pointerId);
    this.rebase();
  }
  rebase() {
    const ps = [...this.pointers.values()];
    if (ps.length >= 2) {
      const [a, b] = ps;
      this.two = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), a: Math.atan2(b.y - a.y, b.x - a.x)};
      ps.forEach((p) => { p.moved = Math.max(20, p.moved); p.skip = false; });
    } else {
      this.two = null;
      /* После жеста двумя пальцами оставшийся палец не должен прыгнуть:
         его первое движение только переустанавливает базу. */
      if (ps.length === 1) ps[0].skip = true;
    }
  }
  pan(dx, dy, s) {
    const k = s.distance * .0017;
    const right = new T.Vector3(Math.cos(s.yaw), 0, Math.sin(s.yaw));
    const up = new T.Vector3(-Math.sin(s.yaw) * Math.sin(s.pitch), Math.cos(s.pitch), Math.cos(s.yaw) * Math.sin(s.pitch));
    s.pan.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
  }
  /* Обзор: вправо тянем — взгляд поворачивается вправо, вверх тянем — взгляд
     поднимается. Знаки согласованы с позицией камеры в update(): смещение
     (-sin yaw, ·, cos yaw) и взгляд (sin yaw, ·, -cos yaw). */
  orbit(dx, dy, s) {
    s.yaw += T.MathUtils.clamp(dx, -180, 180) * ORBIT_SPEED;
    s.pitch -= T.MathUtils.clamp(dy, -180, 180) * TILT_SPEED;
  }
  wheel(e) {
    if (!this.enabled()) return;
    if (typeof e.preventDefault === 'function' && e.cancelable !== false) e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const s = this.state();
    s.distance *= Math.exp(T.MathUtils.clamp((e.deltaY || 0) * unit, -240, 240) * WHEEL_STEP);
    this.clamp(s);
  }
  move(e) {
    const p = this.pointers.get(e.pointerId == null ? 1 : e.pointerId);
    if (!p) return;
    if (!this.enabled()) { this.clear(); return; }
    if (typeof e.preventDefault === 'function' && e.cancelable !== false) e.preventDefault();
    if (p.skip) {                                  // первый кадр после жеста/смены базы
      p.skip = false;
      p.x = e.clientX; p.y = e.clientY;
      p.moved = Math.max(p.moved, 20);
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    p.moved += Math.hypot(dx, dy);
    const s = this.state(), ps = [...this.pointers.values()];
    if (ps.length >= 2) {
      const [a, b] = ps, n = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), a: Math.atan2(b.y - a.y, b.x - a.x)};
      if (this.two) {
        s.distance *= this.two.d / n.d;
        s.yaw += Math.atan2(Math.sin(n.a - this.two.a), Math.cos(n.a - this.two.a));
        this.pan(n.x - this.two.x, n.y - this.two.y, s);
      }
      this.two = n;
    } else {
      if (!p.orbit && p.type === 'mouse' && p.button === 0 && p.moved > TAP_SLOP) p.orbit = true;
      if (p.button === 1) s.distance *= Math.exp(dy * .008);
      else if (p.orbit) this.orbit(dx, dy, s);
    }
    this.clamp(s);
  }
  up(e) {
    const pointerId = e.pointerId == null ? 1 : e.pointerId;
    const p = this.pointers.get(pointerId);
    if (!p) return;
    const isTap = p.type === 'mouse' && p.button === 0 && p.moved < TAP_SLOP && this.pointers.size === 1;
    this.pointers.delete(pointerId);
    this.release(pointerId);
    this.rebase();
    if (isTap && this.enabled()) this.tap?.(e);
  }
  cancel(e) {
    const pointerId = e.pointerId == null ? 1 : e.pointerId;
    if (!this.pointers.has(pointerId)) return;
    this.pointers.delete(pointerId);
    this.release(pointerId);
    this.rebase();
  }
  clear() {
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    this.two = null;
    for (const id of ids) this.release(id);
  }
  /* Сколько указателей сейчас удерживается — нужно игре и тестам. */
  holding(button) {
    for (const p of this.pointers.values()) if (button === undefined || p.button === button) return true;
    return false;
  }
  reset() {
    const f = this.focus(), s = this.state();
    const heading = f.context === 'kitchen' ? 0 : f.heading;
    s.yaw = s.cyaw + Math.atan2(Math.sin(heading - s.cyaw), Math.cos(heading - s.cyaw));
    s.pitch = f.context === 'kitchen' ? -.46 : -.34;
    s.distance = f.context === 'kitchen' ? 2.95 : f.context === 'vehicle' ? 11 : 5.7;
    s.pan.set(0, 0, 0);
    this.clear();
  }
  update(dt) {
    const f = this.focus(), s = this.states[f.context], indoor = f.context === 'kitchen';
    const cam = indoor ? this.kitchenCamera : this.worldCamera;
    if (this.pointers.size && !this.enabled()) this.clear();
    this.clamp(s);
    const changed = this.context !== f.context;
    if (changed) {
      if (this.context && this.context !== 'kitchen' && !indoor) {
        const old = this.states[this.context];
        s.yaw = old.yaw; s.cyaw = old.cyaw; s.cpitch = old.cpitch; s.cdistance = old.cdistance;
      }
      this.anchor.copy(f.position);
      this.context = f.context;
    }
    const a = 1 - Math.exp(-12 * dt);
    s.cyaw += (s.yaw - s.cyaw) * a;
    s.cpitch += (s.pitch - s.cpitch) * a;
    s.cdistance += (s.distance - s.cdistance) * a;
    s.cpan.lerp(s.pan, a);
    this.anchor.lerp(f.position, 1 - Math.exp(-18 * dt));
    // Камера вращается вокруг точки фокуса: сначала панорама, потом орбита.
    const target = this.anchor.clone().add(s.cpan);
    if (!indoor) {
      target.x = T.MathUtils.clamp(target.x, -505, 505);
      target.z = T.MathUtils.clamp(target.z, -505, 505);
      target.y = Math.max(target.y, this.terrain(target.x, target.z) + .65);
    }
    // Gaze pitch may rise to +75 degrees. The orbital position stays above the
    // anchor; look direction, rather than underground motion, reveals the sky.
    const op = Math.min(s.cpitch, -.09), horizontal = s.cdistance * Math.cos(op);
    this.desired.set(target.x - Math.sin(s.cyaw) * horizontal, target.y - Math.sin(op) * s.cdistance, target.z + Math.cos(s.cyaw) * horizontal);
    if (indoor) {
      this.desired.x = T.MathUtils.clamp(this.desired.x, -3.65, 3.65);
      this.desired.z = T.MathUtils.clamp(this.desired.z, -2.75, 4.4);
      this.desired.y = T.MathUtils.clamp(this.desired.y, .42, 5.8);
    } else {
      // Sample the sight-line to avoid terrain and buildings. Collision may shorten
      // the *actual* boom without changing the user's bounded zoom setting.
      for (let i = 1; i <= 14; i++) {
        const f2 = i / 14, p = target.clone().lerp(this.desired, f2);
        let blocked = p.y < this.terrain(p.x, p.z) + .38;
        if (!blocked) {
          for (const o of this.solids()) {
            if (Math.hypot(p.x - o.x, p.z - o.z) < o.r + .18 && p.y < this.terrain(o.x, o.z) + (o.h || 3.5) && p.y > this.terrain(o.x, o.z)) { blocked = true; break; }
          }
        }
        if (blocked) { this.desired.copy(target.clone().lerp(this.desired, Math.max(.13, (i - 1) / 14))); break; }
      }
      this.desired.x = T.MathUtils.clamp(this.desired.x, -520, 520);
      this.desired.z = T.MathUtils.clamp(this.desired.z, -520, 520);
      this.desired.y = Math.max(this.desired.y, this.terrain(this.desired.x, this.desired.z) + .6);
    }
    if (changed && this.activeCamera !== cam) cam.position.copy(this.desired);
    else cam.position.lerp(this.desired, 1 - Math.exp(-24 * dt));
    if (!indoor) {
      cam.position.x = T.MathUtils.clamp(cam.position.x, -520, 520);
      cam.position.z = T.MathUtils.clamp(cam.position.z, -520, 520);
      cam.position.y = Math.max(cam.position.y, this.terrain(cam.position.x, cam.position.z) + .6);
    }
    this.direction.set(Math.sin(s.cyaw) * Math.cos(s.cpitch), Math.sin(s.cpitch), -Math.cos(s.cyaw) * Math.cos(s.cpitch));
    cam.lookAt(cam.position.clone().add(this.direction));
    this.activeCamera = cam;
  }
  snapshot() {
    const s = this.state(), p = this.activeCamera.position;
    return {
      context: this.context, yaw: s.cyaw, pitch: s.cpitch, targetYaw: s.yaw, targetPitch: s.pitch,
      distance: s.cdistance, targetDistance: s.distance, pan: s.pan.toArray(),
      position: p.toArray(), direction: this.direction.toArray(), pointers: this.pointers.size, locked: this.locked
    };
  }
}
