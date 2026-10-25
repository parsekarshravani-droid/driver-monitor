import { useCallback, useEffect, useRef, useState } from "react";
import * as faceapi from "@vladmandic/face-api"; // maintained face-api.js fork, ships its own weights
import { DEFAULTS, DrowsinessTracker, eyeAspectRatio } from "./detection.js";

const MODEL_URL = `${import.meta.env.BASE_URL}models`; // served from dist/models
const DETECT_INTERVAL_MS = 100; // ~10 analyses per second is plenty and keeps phones cool
const EMPTY_STATS = { frames: 0, faceFrames: 0, earSum: 0, maxClosedMs: 0 };
const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};

/** Translate getUserMedia failures into instructions a person can act on. */
function cameraMessage(err) {
  if (!window.isSecureContext) return "Camera access needs HTTPS (or localhost). Open the deployed https:// address.";
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission was denied. Allow camera access in the browser's site settings, then press Start camera.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found. Connect one and press Start camera.";
    case "NotReadableError":
    case "AbortError":
      return "The camera is in use by another app or tab. Close it and try again.";
    default:
      return `The camera could not be started${err?.message ? ` (${err.message})` : ""}.`;
  }
}

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const trackerRef = useRef(new DrowsinessTracker());
  const statsRef = useRef({ ...EMPTY_STATS });
  const baseRef = useRef(0);

  const [models, setModels] = useState({ state: "loading", error: "" });
  const [cam, setCam] = useState({ state: "off", error: "" }); // off | starting | on | error
  const [monitoring, setMonitoring] = useState(false);
  const [cfg, setCfg] = useState(DEFAULTS);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const [live, setLive] = useState({ faces: 0, ear: null, closed: false, closedMs: 0, warning: false });
  const [stats, setStats] = useState({ ...EMPTY_STATS });
  const [history, setHistory] = useState([]);
  const [elapsed, setElapsed] = useState(0);

  // ---- 1. Load models. If this fails we show an error; we never fake detections.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        try { await faceapi.tf.setBackend("webgl"); } catch { await faceapi.tf.setBackend("cpu"); }
        await faceapi.tf.ready();
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL), // fast face box
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL), // 68 points incl. both eyes
        ]);
        if (!cancelled) setModels({ state: "ready", error: "" });
      } catch (e) {
        console.error(e);
        if (!cancelled)
          setModels({ state: "error", error: "Detection models failed to load. Check your connection and reload the page." });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- 2. Camera control
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setMonitoring(false);
    setCam({ state: "off", error: "" });
  }, []);

  const startCamera = useCallback(async () => {
    if (streamRef.current) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCam({ state: "error", error: cameraMessage(null) });
      return false;
    }
    setCam({ state: "starting", error: "" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      v.srcObject = stream;
      await v.play();
      // Stream can end if the camera is unplugged or permission is revoked.
      stream.getVideoTracks()[0].addEventListener("ended", stopCamera);
      setCam({ state: "on", error: "" });
      return true;
    } catch (e) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCam({ state: "error", error: cameraMessage(e) });
      return false;
    }
  }, [stopCamera]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  // ---- 3. Detection loop (runs only while monitoring; fully cleaned up on stop)
  useEffect(() => {
    if (!monitoring) return;
    let raf, last = 0, busy = false, alive = true;
    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
    const tracker = trackerRef.current;

    const tick = async (t) => {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      const video = videoRef.current, canvas = canvasRef.current;
      if (busy || t - last < DETECT_INTERVAL_MS || !video || video.readyState < 2 || !video.videoWidth) return;
      busy = true; last = t;
      try {
        const results = await faceapi.detectAllFaces(video, opts).withFaceLandmarks();
        if (!alive) return;
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Several faces: monitor only the largest (closest to the camera) so
        // a passenger or poster cannot trigger or mask a warning.
        const main = results.reduce((a, b) => (!a || b.detection.box.area > a.detection.box.area ? b : a), null);
        let ear = null;
        if (main) {
          const lm = main.landmarks;
          // Average both eyes: more stable than one eye alone.
          ear = (eyeAspectRatio(lm.getLeftEye()) + eyeAspectRatio(lm.getRightEye())) / 2;
        }
        const r = tracker.update(ear, performance.now(), cfgRef.current);

        // Overlay: face box plus eye outlines (red when closed). Canvas is not
        // mirrored in code; CSS mirrors video and canvas together.
        if (main) {
          const b = main.detection.box;
          const color = r.warning ? "#ff5a5f" : r.closed ? "#ffb547" : "#5cc8ff";
          ctx.lineWidth = 2; ctx.strokeStyle = color;
          ctx.strokeRect(b.x, b.y, b.width, b.height);
          [main.landmarks.getLeftEye(), main.landmarks.getRightEye()].forEach((eye) => {
            ctx.beginPath(); eye.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
            ctx.closePath(); ctx.stroke();
          });
        }

        const s = statsRef.current;
        s.frames++;
        if (main) { s.faceFrames++; s.earSum += ear; }
        s.maxClosedMs = Math.max(s.maxClosedMs, r.closedMs);
        if (r.newWarning) setHistory((h) => [{ id: Date.now(), at: new Date().toLocaleTimeString() }, ...h].slice(0, 50));
        setLive({ faces: results.length, ear: r.ear, closed: r.closed, closedMs: r.closedMs, warning: r.warning });
        setStats({ ...s });
      } catch (e) {
        console.error("Detection error", e);
      } finally {
        busy = false;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      canvasRef.current?.getContext("2d").clearRect(0, 0, 9999, 9999);
      trackerRef.current.reset();
      setLive({ faces: 0, ear: null, closed: false, closedMs: 0, warning: false });
    };
  }, [monitoring]);

  // ---- Session timer: counts only while monitoring
  useEffect(() => {
    if (!monitoring) return;
    const t0 = Date.now(), base = baseRef.current;
    const id = setInterval(() => setElapsed(base + Date.now() - t0), 500);
    return () => { clearInterval(id); baseRef.current = base + Date.now() - t0; };
  }, [monitoring]);

  const toggleMonitoring = async () => {
    if (monitoring) return setMonitoring(false);
    if (models.state !== "ready") return;
    if (await startCamera()) setMonitoring(true);
  };

  const reset = () => {
    setMonitoring(false);
    trackerRef.current.reset();
    statsRef.current = { ...EMPTY_STATS };
    baseRef.current = 0;
    setStats({ ...EMPTY_STATS }); setHistory([]); setElapsed(0);
  };

  const status = !monitoring ? { t: "Not monitoring", c: "idle" }
    : live.faces === 0 ? { t: "No face found", c: "caution" }
    : live.warning ? { t: "Possible drowsiness", c: "alert" }
    : live.closed ? { t: "Eyes closed", c: "caution" }
    : { t: "Eyes open", c: "ok" };
  const earPct = Math.min(100, ((live.ear ?? 0) / 0.4) * 100);
  const set = (k) => (e) => setCfg((c) => ({ ...c, [k]: Number(e.target.value) }));
  const facePct = stats.frames ? Math.round((stats.faceFrames / stats.frames) * 100) : 0;

  return (
    <main className="app">
      <header>
        <h1>Driver attention monitor</h1>
        <p className="notice" role="note">
          Educational prototype. It is not a validated safety device and cannot reliably detect sleep,
          fatigue or fitness to drive. Never rely on it while driving. Video stays in your browser and is never uploaded.
        </p>
      </header>

      <div className="layout">
        <section className="stage" aria-label="Live camera">
          <div className={`frame ${status.c === "alert" ? "frame-alert" : ""}`}>
            <video ref={videoRef} playsInline muted className={cam.state === "on" ? "" : "hidden"} />
            <canvas ref={canvasRef} className={cam.state === "on" ? "" : "hidden"} />
            {cam.state !== "on" && (
              <div className="placeholder">
                {cam.state === "starting" ? <p>Starting camera…</p>
                  : cam.state === "error" ? <p className="err">{cam.error}</p>
                  : <p>Camera is off. Press Start camera to begin.</p>}
              </div>
            )}
            {models.state === "loading" && (
              <div className="overlay"><span className="spinner" /> Loading detection models…</div>
            )}
            {models.state === "error" && <div className="overlay err">{models.error}</div>}
            {live.warning && <div className="banner" role="alert">Possible drowsiness: eyes closed for {(live.closedMs / 1000).toFixed(1)} s</div>}
          </div>

          <div className="controls">
            <button onClick={cam.state === "on" ? stopCamera : startCamera} disabled={cam.state === "starting"}>
              {cam.state === "on" ? "Stop camera" : "Start camera"}
            </button>
            <button className="primary" onClick={toggleMonitoring} disabled={models.state !== "ready" || cam.state === "starting"}>
              {monitoring ? "Stop monitoring" : "Start monitoring"}
            </button>
            <button onClick={reset}>Reset session</button>
          </div>
        </section>

        <aside className="side">
          <div className={`status s-${status.c}`} aria-live="polite">
            <span className="dot" /> {status.t}
            {monitoring && live.faces > 1 && <small>{live.faces} faces; tracking the largest</small>}
          </div>

          <div className="panel">
            <h2>Eye openness</h2>
            <div className="gauge" aria-hidden="true">
              <i style={{ width: `${earPct}%` }} className={live.closed ? "low" : ""} />
              <b style={{ left: `${(cfg.earThreshold / 0.4) * 100}%` }} />
            </div>
            <p className="meta">
              Ratio {live.ear == null ? "–" : live.ear.toFixed(2)} (closed below {cfg.earThreshold.toFixed(2)})
              {" · "}closed for {(live.closedMs / 1000).toFixed(1)} s
            </p>
          </div>

          <div className="panel">
            <h2>Session summary</h2>
            <dl>
              <dt>Duration</dt><dd>{fmt(elapsed)}</dd>
              <dt>Warnings</dt><dd>{history.length}</dd>
              <dt>Longest closure</dt><dd>{(stats.maxClosedMs / 1000).toFixed(1)} s</dd>
              <dt>Face visible</dt><dd>{facePct}% of {stats.frames} checks</dd>
              <dt>Average ratio</dt><dd>{stats.faceFrames ? (stats.earSum / stats.faceFrames).toFixed(2) : "–"}</dd>
            </dl>
          </div>

          <div className="panel">
            <h2>Warning history</h2>
            {history.length === 0 ? <p className="meta">No warnings this session.</p>
              : <ul className="history">{history.map((h) => <li key={h.id}>Possible drowsiness at {h.at}</li>)}</ul>}
          </div>

          <details className="panel">
            <summary>Sensitivity settings</summary>
            <label>Closed below ratio <output>{cfg.earThreshold.toFixed(2)}</output>
              <input type="range" min="0.10" max="0.35" step="0.01" value={cfg.earThreshold} onChange={set("earThreshold")} /></label>
            <label>Warn after closed for <output>{(cfg.closureMs / 1000).toFixed(1)} s</output>
              <input type="range" min="500" max="5000" step="100" value={cfg.closureMs} onChange={set("closureMs")} /></label>
            <label>Smoothing <output>{cfg.smoothing.toFixed(1)}</output>
              <input type="range" min="0" max="0.9" step="0.1" value={cfg.smoothing} onChange={set("smoothing")} /></label>
            <button onClick={() => setCfg(DEFAULTS)}>Restore defaults</button>
          </details>
        </aside>
      </div>
    </main>
  );
}
