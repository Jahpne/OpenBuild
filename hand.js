/* hand.js — camera + MediaPipe Hands index-fingertip tracking, mouse/touch fallback,
   and exponential smoothing so fast or laggy tracking still looks fluid. */
const HandTracker = (() => {
  const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands';
  const SMOOTH = 18;                       // higher = snappier, lower = silkier
  const LOST_MS = 250;                     // how long a missing hand is tolerated
  let video = null, hands = null, running = false, busy = false;
  let mode = 'none';                       // 'camera' | 'mouse' | 'none'
  let rawX = 0.5, rawY = 0.5, hasHand = false, lastSeen = 0;
  let mX = 0.5, mY = 0.5, mSeen = 0;
  let tipX = 0.5, tipY = 0.5, wasActive = false;
  let vw = 640, vh = 480;
  const out = { x: 0.5, y: 0.5, active: false, source: 'none' };

  // Mouse & touch: pointer events cover both. Coordinates are normalised to the viewport.
  addEventListener('pointermove', e => { mX = e.clientX / innerWidth; mY = e.clientY / innerHeight; mSeen = performance.now(); }, { passive: true });
  addEventListener('pointerdown', e => { mX = e.clientX / innerWidth; mY = e.clientY / innerHeight; mSeen = performance.now(); }, { passive: true });

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (window.Hands) return res();
      const s = document.createElement('script');
      s.src = src; s.crossOrigin = 'anonymous';
      s.onload = res; s.onerror = () => rej(new Error('script'));
      document.head.appendChild(s);
    });
  }

  // Throws Errors whose message starts with a CODE: so the UI can show a clear reason.
  async function startCamera() {
    if (!window.isSecureContext) throw new Error('INSECURE: Camera needs HTTPS (or localhost). Open the hosted https:// link.');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('NO_API: This browser cannot access a camera. Try Chrome or Edge.');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    } catch (e) {
      const n = e && e.name;
      if (n === 'NotAllowedError' || n === 'SecurityError') throw new Error('DENIED: Camera permission was blocked. Click the camera icon in the address bar, allow it, then press RETRY. Or use mouse/touch.');
      if (n === 'NotFoundError' || n === 'OverconstrainedError') throw new Error('NO_CAMERA: No webcam was found. Plug one in, or use mouse/touch.');
      if (n === 'NotReadableError') throw new Error('BUSY: The camera is used by another app (Zoom, Teams…). Close it and press RETRY.');
      throw new Error('CAMERA: ' + (e && e.message ? e.message : 'unknown camera error'));
    }
    video = document.getElementById('webcam');
    video.srcObject = stream;
    await video.play();
    vw = video.videoWidth || 640; vh = video.videoHeight || 480;
  }

  async function loadModel(onStatus) {
    onStatus && onStatus('Loading hand model from CDN…');
    try { await loadScript(MP_BASE + '/hands.js'); }
    catch (e) { throw new Error('MODEL: Could not download MediaPipe Hands. Check your internet connection and reload.'); }
    if (!window.Hands) throw new Error('MODEL: MediaPipe did not initialise. Reload the page.');
    hands = new Hands({ locateFile: f => `${MP_BASE}/${f}` });
    hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
    hands.onResults(onResults);
    if (typeof hands.initialize === 'function') {
      onStatus && onStatus('Warming up the model (first load only)…');
      await hands.initialize();
    }
  }

  function onResults(res) {
    const lm = res.multiHandLandmarks && res.multiHandLandmarks[0];
    if (!lm) return;
    const p = lm[8];                       // index fingertip
    rawX = 1 - p.x;                        // mirror so moving right feels right
    rawY = p.y;
    hasHand = true; lastSeen = performance.now();
  }

  // Map camera-normalised coords to the screen, matching CSS object-fit: cover.
  function toScreen(nx, ny) {
    const W = innerWidth, H = innerHeight;
    const s = Math.max(W / vw, H / vh);
    const dw = vw * s, dh = vh * s;
    const ox = (dw - W) / 2, oy = (dh - H) / 2;
    return { x: (nx * dw - ox) / W, y: (ny * dh - oy) / H };
  }

  async function pump() {
    if (!running) return;
    if (!busy && hands && video && video.readyState >= 2) {
      busy = true;
      try { await hands.send({ image: video }); } catch (e) { console.warn('hands.send', e); }
      busy = false;
    }
    requestAnimationFrame(pump);
  }

  return {
    /** Start camera + model. Calls onStatus with human-readable progress. */
    async init(onStatus) {
      onStatus && onStatus('Requesting camera access…');
      await startCamera();
      await loadModel(onStatus);
      running = true; mode = 'camera';
      document.body.classList.add('cam-on');
      pump();
    },
    setMode(m) {
      mode = m;
      if (m !== 'camera') document.body.classList.remove('cam-on');
      else if (running) document.body.classList.add('cam-on');
    },
    isCameraRunning() { return running; },
    /** Call once per frame. Returns smoothed fingertip in screen-normalised coords. */
    update(dt) {
      let tx, ty, active;
      if (mode === 'mouse') {
        tx = mX; ty = mY; active = performance.now() - mSeen < 180;
      } else if (mode === 'camera' && running) {
        const s = toScreen(rawX, rawY); tx = s.x; ty = s.y;
        active = hasHand && performance.now() - lastSeen < LOST_MS;
      } else {
        tx = tipX; ty = tipY; active = false;
      }
      if (active && !wasActive) { tipX = tx; tipY = ty; }   // snap on (re)acquire
      const k = 1 - Math.exp(-SMOOTH * Math.min(dt, 0.05));  // frame-rate independent lerp
      tipX += (tx - tipX) * k; tipY += (ty - tipY) * k;
      wasActive = active;
      out.x = tipX; out.y = tipY; out.active = active; out.source = mode;
      return out;
    }
  };
})();
