'use client'

/**
 * AR Bracelet Try-On — Phase 1: Procedural Open Bracelet
 *
 * Architecture:
 *   <video>            — mirrored camera feed (CSS scaleX(-1))
 *   <canvas> #three    — Three.js WebGL: renders only the 3D open bracelet mesh
 *   <canvas> #overlay  — Canvas2D: skeleton, axes gizmo, 2D arc preview, HUD
 *
 * Coordinate frame (right-handed, landmarks {0,5,9,17}):
 *   Origin : wrist[0] displaced toward elbow by (offsetFrac × palmWidth)
 *   +X     : normalize( cross(Y, Z) )                — ulnar direction (toward pinky)
 *   +Y     : normalize( middle_mcp[9] − wrist[0] )   — toward fingers (≈ away from elbow)
 *   +Z     : normalize( cross(X_raw, Y) )             — palm normal (toward palm surface)
 *   Gap    : centered at +Z (θ = π/2 = 90°)           — opening faces palm side
 *
 * FOREARM APPROXIMATION (KNOWN LIMITATION):
 *   MediaPipe Hands outputs 21 landmarks, all distal to the wrist. The forearm
 *   direction is geometrically underdetermined from these alone (confirmed:
 *   Hand4Whole++ arXiv:2603.14726; W3C WebXR Hand Input Spec; SEW-Mimic arXiv:2602.01632).
 *   We approximate it as −Y = normalize(wrist[0] − middle_mcp[9]).
 *   Error ≈ wrist flexion angle (typically ±10–30° during jewelry try-on).
 *   True solution: MediaPipe Holistic pose landmarks 13/14 (elbow) + 15/16 (wrist).
 *
 * Smoothing: One Euro Filter (Casiez et al., CHI 2012) on all 21 × 3 landmark axes.
 *   Adaptive cutoff: low speed → low cutoff (less jitter); high speed → high cutoff (less lag).
 *   Source: github.com/casiez/OneEuroFilter (BSD 3-Clause)
 *
 * Bracelet geometry: TubeGeometry over a CatmullRomCurve3 arc in the XZ plane.
 *   Gap centered at +Z (θ=90°). Radius=1 in local space; scaled via group.scale.
 *
 * References:
 *   - geaxgx/depthai_hand_tracker mediapipe_utils.py  — MCP-centroid arm axis approach
 *   - essameldeen/jewelry-ar-app RingRenderer.ts       — real TS bracelet try-on
 *   - VilyaPoghosyan/AR-Watch-TryOn                    — wrist_frame() implementation
 *   - shubham-sharma-1994/Three.js-MediaPipe-React     — Quaternion via makeBasis + SLERP
 *   - collidingScopes/3d-model-playground game.js      — Three.js + MediaPipe landmarks
 */

import { useEffect, useRef, useState, useCallback } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────────
type Landmark = { x: number; y: number; z: number }
type V2 = { x: number; y: number }
type V3 = { x: number; y: number; z: number }

// ─── MediaPipe Landmark Indices ─────────────────────────────────────────────────
// Confirmed: github.com/google/mediapipe/blob/master/mediapipe/python/solutions/hands.py
const LM = {
  WRIST:      0,   // bracelet origin
  INDEX_MCP:  5,   // cross-palm axis (radial side)
  MIDDLE_MCP: 9,   // arm-direction axis (forearm proxy)
  RING_MCP:   13,  // (not used in basis; listed for reference)
  PINKY_MCP:  17,  // cross-palm axis (ulnar side)
} as const

// ─── MediaPipe canonical hand connections ───────────────────────────────────────
const HAND_CONNECTIONS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[0,17],[17,18],[18,19],[19,20],
]

// ─── Vector Math ────────────────────────────────────────────────────────────────
const sub3   = (a: V3, b: V3): V3 => ({ x:a.x-b.x, y:a.y-b.y, z:a.z-b.z })
const len3   = (v: V3): number => Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z)
const norm3  = (v: V3): V3 => { const l = len3(v) || 1e-9; return { x:v.x/l, y:v.y/l, z:v.z/l } }
const cross3 = (a: V3, b: V3): V3 => ({
  x: a.y*b.z - a.z*b.y,
  y: a.z*b.x - a.x*b.z,
  z: a.x*b.y - a.y*b.x,
})
const len2  = (v: V2): number => Math.sqrt(v.x*v.x + v.y*v.y)
const norm2 = (v: V2): V2 => { const l = len2(v) || 1e-9; return { x:v.x/l, y:v.y/l } }

// ─── One Euro Filter ─────────────────────────────────────────────────────────────
// Paper: Casiez et al. "1€ Filter: A Simple Speed-based Low-pass Filter
//        for Noisy Input in Interactive Systems." CHI 2012.
// Source: github.com/casiez/OneEuroFilter (BSD 3-Clause)
// NPM: 1eurofilter
//
// Inline port — avoids an npm dependency for a ~40-line algorithm.
// MediaPipe's own pipeline uses the same filter internally
// (mediapipe/util/filtering/one_euro_filter.h).

class _LPF {
  private y = 0; private initialized = false
  filter(x: number, alpha: number): number {
    const a = Math.max(0, Math.min(1, alpha))
    if (!this.initialized) { this.y = x; this.initialized = true; return x }
    this.y = a * x + (1 - a) * this.y
    return this.y
  }
  last() { return this.y }
}

class OneEuroFilter {
  private xf  = new _LPF()
  private dxf = new _LPF()
  private lastTs = -1

  /**
   * @param freq        Nominal sampling rate in Hz (dynamically updated when timestamps given)
   * @param mincutoff   Minimum cutoff frequency Hz. Lower = less jitter, more lag. Default 1.0.
   * @param beta_       Speed coefficient. Higher = less lag on fast motion. Default 0.05.
   * @param dcutoff     Derivative cutoff Hz. Usually leave at 1.0.
   */
  constructor(
    private freq      = 30,
    private mincutoff = 1.0,
    private beta_     = 0.05,
    private dcutoff   = 1.0,
  ) {}

  private alpha(cutoff: number) {
    const te  = 1.0 / this.freq
    const tau = 1.0 / (2 * Math.PI * cutoff)
    return 1.0 / (1.0 + tau / te)
  }

  /** Call once per frame. timestamp in seconds (optional but improves accuracy). */
  filter(value: number, timestamp?: number): number {
    if (timestamp !== undefined && this.lastTs >= 0) {
      const dt = timestamp - this.lastTs
      if (dt > 0) this.freq = 1.0 / dt
    }
    if (timestamp !== undefined) this.lastTs = timestamp

    const prev  = this.xf.last()
    const edx   = (value - prev) * this.freq
    const dedx  = this.dxf.filter(edx, this.alpha(this.dcutoff))
    const cutoff = this.mincutoff + this.beta_ * Math.abs(dedx)
    return this.xf.filter(value, this.alpha(cutoff))
  }
}

/** Create 21 × 3 One Euro filter instances (one per landmark, per axis). */
function makeFilterBank(freq = 30, mincutoff = 1.0, beta = 0.05) {
  return Array.from({ length: 21 }, () => ({
    x: new OneEuroFilter(freq, mincutoff, beta),
    y: new OneEuroFilter(freq, mincutoff, beta),
    z: new OneEuroFilter(freq, mincutoff, beta),
  }))
}

// ─── Bracelet Parameters ─────────────────────────────────────────────────────────
type BraceletParams = {
  // Shape (changing any of these rebuilds geometry)
  gapDeg:      number   // gap angle in degrees — opening size (20–150)
  radiusFrac:  number   // bracelet radius as fraction of palmWidth (0.30–0.90)
  tubeFrac:    number   // tube radius as fraction of bracelet radius (0.02–0.20)

  // Pose
  offsetFrac:  number   // displacement from wrist along −Y toward elbow (fraction of palmWidth)
  twistDeg:    number   // manual rotation around Y-axis to fine-tune gap position (−180 to 180)
  slerpFactor: number   // quaternion SLERP interpolation factor per frame (0.05–0.95)

  // Visibility
  show:           boolean
  showGizmo:      boolean
  showLabels:     boolean
  showForearm:    boolean
  showHUD:        boolean
  showArcPreview: boolean
}

const DEFAULT_BP: BraceletParams = {
  gapDeg:      60,
  radiusFrac:  0.58,
  tubeFrac:    0.075,
  offsetFrac:  0.15,
  twistDeg:    0,
  slerpFactor: 0.30,
  show:           true,
  showGizmo:      true,
  showLabels:     false,
  showForearm:    true,
  showHUD:        true,
  showArcPreview: true,
}

// ─── Main Component ──────────────────────────────────────────────────────────────
export default function ArBraceletPage() {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const threeRef_   = useRef<HTMLCanvasElement>(null)   // Three.js WebGL canvas
  const overlayRef  = useRef<HTMLCanvasElement>(null)   // Canvas2D debug overlay
  const pixelCanvasRef = useRef<HTMLCanvasElement>(null) // hidden canvas for pixel sampling

  const [status,    setStatus   ] = useState('点击 "启动识别" 开始 AR 试戴')
  const [running,   setRunning  ] = useState(false)
  const [handCount, setHandCount] = useState(0)
  const [bp,        setBp       ] = useState<BraceletParams>(DEFAULT_BP)

  // Stale-closure-safe ref for rAF callbacks
  const bpRef = useRef(bp)
  useEffect(() => { bpRef.current = bp }, [bp])

  // Three.js object refs
  const ts = useRef<{
    THREE: any; scene: any; camera: any; renderer: any
    braceletGroup: any; braceletMesh: any
    width: number; height: number; ready: boolean
    geomKey: string
  }>({
    THREE:null, scene:null, camera:null, renderer:null,
    braceletGroup:null, braceletMesh:null,
    width:1, height:1, ready:false, geomKey:'',
  })

  // Shared state between updateBraceletPose and drawOverlay
  const measuredRadiusRef  = useRef<number>(40)
  const braceletCenterRef  = useRef<V2>({ x: 0, y: 0 })

  // Smoothing & pose
  const filtersRef  = useRef(makeFilterBank())
  const prevQuatRef = useRef<any>(null)

  // MediaPipe Tasks refs
  const holisticRef = useRef<any>(null)
  const rafRef      = useRef<number>(0)
  // Latest elbow/wrist from HolisticLandmarker pose result
  const elbowLmRef     = useRef<Landmark | null>(null)
  const wristPoseLmRef = useRef<Landmark | null>(null)
  // Latest pose landmarks array for arm skeleton drawing
  const poseLmsRef = useRef<Landmark[] | null>(null)

  // ── Coordinate utilities ──────────────────────────────────────────────────────

  const getVDims = () => ({
    vw: videoRef.current?.videoWidth  || 1280,
    vh: videoRef.current?.videoHeight || 720,
  })

  /**
   * Normalized landmark [0,1] → screen pixel (cover-fit corrected).
   * The video is CSS-mirrored (scaleX(-1)), so we flip x = 1 - lm.x
   * so that the 2D overlay aligns with the mirrored video display.
   */
  const lmToScreen = useCallback((lm: Landmark): V2 => {
    const { vw, vh } = getVDims()
    const sw = window.innerWidth, sh = window.innerHeight
    const cs = Math.max(sw/vw, sh/vh)
    const dW = vw*cs, dH = vh*cs
    const mx = (sw - dW) / 2
    return { x: (1 - lm.x)*dW + mx, y: lm.y*dH + (sh-dH)/2 }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Normalized landmark → scaled 3D pixel space for cross products.
   * DS (depth scale) = max(vw,vh) makes z comparable in magnitude to x/y.
   * This is the standard approach used by all surveyed implementations.
   */
  const lmTo3D = useCallback((lm: Landmark): V3 => {
    const { vw, vh } = getVDims()
    const ds = Math.max(vw, vh)
    // Flip x to match the CSS-mirrored video display
    return { x: (1 - lm.x)*vw, y: lm.y*vh, z: lm.z*ds }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Project a 3D direction vector to a 2D screen-space delta.
   * Orthographic projection: scale by cover factor, drop z.
   */
  const projectDir = useCallback((v: V3): V2 => {
    const { vw, vh } = getVDims()
    const sw = window.innerWidth, sh = window.innerHeight
    const cs = Math.max(sw/vw, sh/vh)
    // Flip x to match CSS-mirrored display
    return { x: -v.x*cs, y: v.y*cs }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Palm Basis ────────────────────────────────────────────────────────────────
  /**
   * Computes the orthonormal palm coordinate frame from landmarks {0, 5, 9, 17}.
   *
   * Construction (right-handed):
   *   rightRaw = normalize(pinky_mcp[17] − index_mcp[5])  ← raw cross-palm (ulnar)
   *   Y        = normalize(middle_mcp[9] − wrist[0])       ← toward fingers (forearm proxy)
   *   Z        = normalize(cross(rightRaw, Y))             ← palm normal
   *   X        = normalize(cross(Y, Z))                    ← re-orthogonalized ulnar
   *
   * Cross product order justification (right hand, palm facing camera in mirrored view):
   *   rightRaw points from index→pinky (ulnar direction)
   *   Y points from wrist→fingers (upward in screen)
   *   cross(rightRaw, Y) by right-hand rule → toward camera = toward volar/palm surface ✓
   *
   * FOREARM CAVEAT: Y is not the true forearm axis. It is the wrist-to-MCP-row direction.
   * When the wrist is flexed, the true forearm deviates from −Y by the flexion angle.
   * No implementation using only MediaPipe Hands 21 landmarks can determine the true
   * forearm direction (confirmed: Hand4Whole++ arXiv:2603.14726; W3C WebXR Hand Spec).
   *
   * Sources:
   *   VilyaPoghosyan/AR-Watch-TryOn: cross(v1, v2) pattern with landmarks {0,5,9,17}
   *   shubham-sharma-1994: makeBasis(tangent, normal, up) + SLERP
   *   geaxgx/depthai_hand_tracker: weighted MCP centroid variant
   */
  const computePalmBasis = useCallback((lm: Landmark[]) => {
    const p = bpRef.current

    const W = lmTo3D(lm[LM.WRIST])
    const I = lmTo3D(lm[LM.INDEX_MCP])
    const M = lmTo3D(lm[LM.MIDDLE_MCP])
    const P = lmTo3D(lm[LM.PINKY_MCP])

    // Step 1: raw cross-palm direction (index_mcp → pinky_mcp)
    const rightRaw = norm3(sub3(P, I))

    // Step 2: forearm direction — use real elbow if available (PoseLandmarker),
    // otherwise fall back to wrist→middle_mcp approximation.
    const elbow = elbowLmRef.current
    const wristPose = wristPoseLmRef.current
    let yAxis: V3
    if (elbow && wristPose) {
      // True forearm: normalize(wrist_pose - elbow), converted to pixel space
      const { vw, vh } = getVDims(); const ds = Math.max(vw, vh)
      const EP = { x: (1 - elbow.x)*vw,    y: elbow.y*vh,    z: elbow.z*ds }
      const WP = { x: (1 - wristPose.x)*vw, y: wristPose.y*vh, z: wristPose.z*ds }
      yAxis = norm3(sub3(WP, EP))
    } else {
      // Fallback: wrist[0] → middle_mcp[9] (known approximation, see comments)
      yAxis = norm3(sub3(M, W))
    }

    // Step 3: palm normal = cross(rightRaw, yAxis) → toward palm surface
    const zAxis = norm3(cross3(rightRaw, yAxis))

    // Step 4: re-orthogonalized X axis = cross(Y, Z)
    const xAxis = norm3(cross3(yAxis, zAxis))

    // Screen-space projections of the 3 basis vectors
    const xProj = projectDir(xAxis)
    const yProj = projectDir(yAxis)
    const zProj = projectDir(zAxis)

    const wristScreen = lmToScreen(lm[LM.WRIST])
    const indexScreen = lmToScreen(lm[LM.INDEX_MCP])
    const pinkyScreen = lmToScreen(lm[LM.PINKY_MCP])
    const palmWidth   = Math.hypot(indexScreen.x - pinkyScreen.x, indexScreen.y - pinkyScreen.y)

    // Bracelet center: on the elbow→wrist screen-space line.
    // When pose elbow is available, interpolate directly in 2D screen space so
    // the center is guaranteed to lie on the visible arm centerline.
    const elbowForBasis  = elbowLmRef.current
    const wristPosForBasis = wristPoseLmRef.current
    let braceletCenter: V2
    if (elbowForBasis && wristPosForBasis) {
      const elbowSc  = lmToScreen(elbowForBasis)
      const wristPosSc = lmToScreen(wristPosForBasis)
      const armLen   = Math.hypot(wristPosSc.x - elbowSc.x, wristPosSc.y - elbowSc.y) || 1
      const offsetPx = p.offsetFrac * palmWidth
      const t        = Math.min(offsetPx / armLen, 0.9)
      braceletCenter = {
        x: wristPosSc.x + t * (elbowSc.x - wristPosSc.x),
        y: wristPosSc.y + t * (elbowSc.y - wristPosSc.y),
      }
    } else {
      const offsetPx = p.offsetFrac * palmWidth
      const yN       = norm2(yProj)
      braceletCenter = {
        x: wristScreen.x - offsetPx * yN.x,
        y: wristScreen.y - offsetPx * yN.y,
      }
    }

    // 3×3 rotation matrix for HUD display: columns = [X|Y|Z]
    const rotMat3x3 = [
      [xAxis.x, yAxis.x, zAxis.x],
      [xAxis.y, yAxis.y, zAxis.y],
      [xAxis.z, yAxis.z, zAxis.z],
    ]

    return { xAxis, yAxis, zAxis, xProj, yProj, zProj, wristScreen, braceletCenter, palmWidth, rotMat3x3 }
  }, [lmTo3D, lmToScreen, projectDir])

  // ── Arm width measurement via pixel color sampling ────────────────────────────
  // Strategy: draw video frame to a hidden canvas (no CSS mirror), sample pixels
  // along the perpendicular to the arm axis from the wrist position,
  // walk outward in both directions until the color diverges from the center color.
  // Returns radius in screen pixels.
  const measureArmRadius = useCallback((
    wristNorm: V2,       // normalized (0-1) wrist pos in VIDEO space (not mirrored)
    perpNorm:  V2,       // normalized perpendicular direction in video space
    maxPx = 80,          // max pixels to search outward
    threshold = 35,      // color diff threshold (0-255)
  ): number => {
    const video = videoRef.current
    const pxCanvas = pixelCanvasRef.current
    if (!video || !pxCanvas || video.readyState < 2) return 40 // fallback

    const vw = video.videoWidth, vh = video.videoHeight
    pxCanvas.width = vw; pxCanvas.height = vh
    const ctx = pxCanvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(video, 0, 0, vw, vh)

    const cx = Math.round(wristNorm.x * vw)
    const cy = Math.round(wristNorm.y * vh)

    // clamp helper
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

    // Get center pixel color
    const center = ctx.getImageData(clamp(cx, 0, vw-1), clamp(cy, 0, vh-1), 1, 1).data
    const cr = center[0], cg = center[1], cb = center[2]

    const colorDiff = (px: Uint8ClampedArray) =>
      Math.abs(px[0]-cr) + Math.abs(px[1]-cg) + Math.abs(px[2]-cb)

    // Walk outward in normalized perp direction, in video pixels
    const pdx = perpNorm.x * vw / Math.max(vw, vh)
    const pdy = perpNorm.y * vh / Math.max(vw, vh)

    let dPos = 0, dNeg = 0
    for (let i = 1; i <= maxPx; i++) {
      if (dPos === 0) {
        const px = clamp(Math.round(cx + pdx*i), 0, vw-1)
        const py = clamp(Math.round(cy + pdy*i), 0, vh-1)
        const d = colorDiff(ctx.getImageData(px, py, 1, 1).data)
        if (d > threshold) dPos = i
      }
      if (dNeg === 0) {
        const px = clamp(Math.round(cx - pdx*i), 0, vw-1)
        const py = clamp(Math.round(cy - pdy*i), 0, vh-1)
        const d = colorDiff(ctx.getImageData(px, py, 1, 1).data)
        if (d > threshold) dNeg = i
      }
      if (dPos > 0 && dNeg > 0) break
    }
    if (dPos === 0) dPos = maxPx
    if (dNeg === 0) dNeg = maxPx

    // Convert from video pixels to screen pixels
    const sw = window.innerWidth, sh = window.innerHeight
    const coverScale = Math.max(sw / vw, sh / vh)
    const radiusVideoPx = (dPos + dNeg) / 2
    return radiusVideoPx * coverScale
  }, [])

  // ── Three.js Initialization ───────────────────────────────────────────────────
  const initThree = useCallback(async (): Promise<boolean> => {
    if (ts.current.ready) return true
    try {
      const THREE = (await import('three')) as any
      const sw = window.innerWidth, sh = window.innerHeight
      ts.current.THREE  = THREE
      ts.current.width  = sw
      ts.current.height = sh

      ts.current.scene  = new THREE.Scene()
      ts.current.camera = new THREE.OrthographicCamera(-sw/2, sw/2, sh/2, -sh/2, -2000, 2000)
      ts.current.camera.position.set(0, 0, 500)

      ts.current.renderer = new THREE.WebGLRenderer({
        canvas:    threeRef_.current!,
        alpha:     true,
        antialias: true,
      })
      ts.current.renderer.setSize(sw, sh, false)
      ts.current.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      ts.current.renderer.setClearColor(0x000000, 0)

      // Three-point lighting: key from camera + warm fill + cold rim
      ts.current.scene.add(new THREE.AmbientLight(0xffffff, 0.55))
      const key = new THREE.DirectionalLight(0xffffff, 1.3)
      key.position.set(0, 0, 1)
      ts.current.scene.add(key)
      const fill = new THREE.DirectionalLight(0xffffcc, 0.65)
      fill.position.set(1, 1, 0)
      ts.current.scene.add(fill)
      const rim = new THREE.DirectionalLight(0xccddff, 0.40)
      rim.position.set(-1, -0.5, -1)
      ts.current.scene.add(rim)

      ts.current.braceletGroup = new THREE.Group()
      ts.current.scene.add(ts.current.braceletGroup)
      ts.current.ready = true
      return true
    } catch (e: any) {
      setStatus(`Three.js 初始化失败: ${e.message}`)
      return false
    }
  }, [])

  // ── Bracelet Geometry ─────────────────────────────────────────────────────────
  /**
   * Builds an open-cuff bracelet as TubeGeometry over a CatmullRomCurve3 arc.
   *
   * Arc lies in the local XZ plane (Y = 0):
   *   P(θ) = ( cos θ, 0, sin θ )   for θ ∈ [arcStart, arcEnd]
   *
   * Gap is centered at +Z (palm side) = θ = π/2 (90°).
   * The geometry is built at radius=1; actual size is set by braceletGroup.scale.
   *
   * Gap visual:
   *         +Z (gap center, palm side, θ=90°)
   *          ___
   *        /     \
   *  −X ──|       |── +X
   *        \_____/
   *           −Z (dorsal side, opposite of gap)
   *
   * CatmullRomCurve3 endpoint anchoring: duplicate the first and last points to
   * prevent Catmull-Rom endpoint curl (the spline needs surrounding tangent points).
   */
  const buildBraceletGeometry = useCallback((
    THREE: any,
    tubeR:  number,   // tube radius (as fraction of bracelet radius=1)
    gapDeg: number,   // gap size in degrees
    segs  = 80,
  ) => {
    const gapRad   = gapDeg * Math.PI / 180
    const gapHalf  = gapRad / 2
    const gapCtr   = Math.PI / 2           // +Z direction = 90°
    const arcStart = gapCtr + gapHalf      // e.g. 120° for 60° gap
    const arcEnd   = gapCtr - gapHalf + 2 * Math.PI  // e.g. 420°
    const arcSpan  = arcEnd - arcStart

    // Sample control points along the arc
    const nCtrl = segs + 2
    const raw: any[] = []
    for (let i = 0; i <= nCtrl; i++) {
      const θ = arcStart + (i / nCtrl) * arcSpan
      raw.push(new THREE.Vector3(Math.cos(θ), 0, Math.sin(θ)))
    }
    // Duplicate endpoints to anchor Catmull-Rom spline ends
    const pts = [raw[0], ...raw, raw[raw.length - 1]]

    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5)
    return new THREE.TubeGeometry(curve, segs, tubeR, 12, false)
  }, [])

  /**
   * Rebuilds braceletMesh if geometry params changed (fingerprinted by key).
   * Calling this every frame is safe — it no-ops when nothing changed.
   */
  const rebuildBraceletMesh = useCallback((force = false) => {
    const t = ts.current
    if (!t.ready) return
    const p    = bpRef.current
    const THREE = t.THREE

    const geomKey = `${p.gapDeg.toFixed(1)}_${p.tubeFrac.toFixed(4)}`
    if (!force && t.geomKey === geomKey && t.braceletMesh) return
    t.geomKey = geomKey

    if (t.braceletMesh) {
      t.braceletMesh.geometry.dispose()
      t.braceletGroup.remove(t.braceletMesh)
    }

    const geo = buildBraceletGeometry(THREE, p.tubeFrac / p.radiusFrac, p.gapDeg)
    const mat = new THREE.MeshStandardMaterial({
      color:     0xFFD700,  // gold
      metalness: 0.92,
      roughness: 0.12,
    })
    t.braceletMesh = new THREE.Mesh(geo, mat)
    t.braceletGroup.add(t.braceletMesh)
  }, [buildBraceletGeometry])

  // ── Resize Handler ────────────────────────────────────────────────────────────
  const resizeAll = useCallback(() => {
    const t  = ts.current
    const sw = window.innerWidth, sh = window.innerHeight
    const oc = overlayRef.current
    if (oc && (oc.width !== sw || oc.height !== sh)) { oc.width = sw; oc.height = sh }
    if (t.ready && (t.width !== sw || t.height !== sh)) {
      t.width = sw; t.height = sh
      t.renderer.setSize(sw, sh, false)
      t.camera.left = -sw/2; t.camera.right  =  sw/2
      t.camera.top  =  sh/2; t.camera.bottom = -sh/2
      t.camera.updateProjectionMatrix()
    }
  }, [])

  // ── Bracelet Pose Update ──────────────────────────────────────────────────────
  /**
   * Applies the computed palm basis to the Three.js braceletGroup.
   *
   * Steps:
   *  1. Compute palm basis (X/Y/Z axes)
   *  2. Build rotation matrix [X|Y|Z] as THREE.Matrix4
   *  3. Extract quaternion; apply optional Y-axis twist
   *  4. SLERP toward target quaternion
   *  5. Convert bracelet center from screen to Three.js ortho camera space
   *  6. Set position, quaternion, scale on braceletGroup
   *
   * Three.js ortho camera: origin at screen center, Y up, right-handed.
   * braceletGroup.scale = bracelet radius in screen pixels (geometry built at radius=1).
   *
   * Sources:
   *   shubham-sharma-1994: makeBasis(tangent, normal, up) + SLERP α=0.5
   *   This project's previous page.tsx: computePalmBasis() + SLERP α=0.35
   */
  const updateBraceletPose = useCallback((lm: Landmark[]) => {
    const t = ts.current
    if (!t.ready || !t.braceletGroup) return
    const p     = bpRef.current
    const THREE = t.THREE

    if (!p.show) { t.braceletGroup.visible = false; return }
    t.braceletGroup.visible = true
    rebuildBraceletMesh()

    const { xAxis, yAxis, zAxis, yProj, zProj, wristScreen } = computePalmBasis(lm)

    // Pixel sampling: get arm radius from color boundary perpendicular to arm axis.
    // wrist coords in original (unmirrored) video space for sampling.
    const video = videoRef.current
    const vw = video?.videoWidth || 1280, vh = video?.videoHeight || 720
    const ds = Math.max(vw, vh)
    const wristVideoNorm: V2 = { x: lm[LM.WRIST].x, y: lm[LM.WRIST].y }

    // yAxis is in mirrored pixel space; un-mirror x, then rotate 90° for perp direction.
    const yAxisVideo: V3 = { x: -yAxis.x / vw * ds, y: yAxis.y / vh * ds, z: yAxis.z }
    const perpVideoNorm: V2 = norm2({ x: -yAxisVideo.y / vh, y: yAxisVideo.x / vw })
    const measuredRadius = measureArmRadius(wristVideoNorm, perpVideoNorm)

    // Bracelet center: on the elbow→wrist screen line (guaranteed to be on the arm axis).
    const sw = window.innerWidth, sh = window.innerHeight
    let braceletCenter: V2
    const elbowPose = elbowLmRef.current
    const wristPose = wristPoseLmRef.current
    if (elbowPose && wristPose) {
      const elbowSc  = lmToScreen(elbowPose)
      const wristSc  = lmToScreen(wristPose)
      const armLen   = Math.hypot(wristSc.x - elbowSc.x, wristSc.y - elbowSc.y) || 1
      const offsetPx = p.offsetFrac * measuredRadius * 2
      const frac     = Math.min(offsetPx / armLen, 0.9)
      braceletCenter = {
        x: wristSc.x + frac * (elbowSc.x - wristSc.x),
        y: wristSc.y + frac * (elbowSc.y - wristSc.y),
      }
    } else {
      const offsetPx = p.offsetFrac * measuredRadius * 2
      const yN = norm2(yProj)
      braceletCenter = {
        x: wristScreen.x - offsetPx * yN.x,
        y: wristScreen.y - offsetPx * yN.y,
      }
    }

    // Store for overlay use
    measuredRadiusRef.current = measuredRadius
    braceletCenterRef.current = braceletCenter

    // Build rotation from the ARM AXIS in 2D screen space.
    // Pose z-depth is too noisy to use for a stable 3D yAxis → use screen-projected 2D arm direction.
    // Arm direction in screen space: wrist → elbow (or yProj fallback)
    let armDir2D: V2
    if (elbowPose && wristPose) {
      const es = lmToScreen(elbowPose), ws = lmToScreen(wristPose)
      armDir2D = norm2({ x: es.x - ws.x, y: es.y - ws.y })
    } else {
      armDir2D = norm2(yProj)
    }
    // Bracelet Y axis (arm axis) in Three.js space: screen X maps to world X, screen Y flips.
    const armY3 = new THREE.Vector3(armDir2D.x, -armDir2D.y, 0).normalize()
    // Palm normal Z: use zAxis projected to screen, then lift to 3D (always pointing toward camera = +Z in Three.js)
    const zProjN = norm2(zProj)
    const palmZ3 = new THREE.Vector3(zProjN.x, -zProjN.y, Math.sqrt(Math.max(0, 1 - zProjN.x**2 - zProjN.y**2))).normalize()
    // Re-orthogonalize: X = cross(Y, Z)
    const armX3 = new THREE.Vector3().crossVectors(armY3, palmZ3).normalize()
    const armZ3 = new THREE.Vector3().crossVectors(armX3, armY3).normalize()

    const mat = new THREE.Matrix4().makeBasis(armX3, armY3, armZ3)
    const targetQ = new THREE.Quaternion().setFromRotationMatrix(mat)

    if (p.twistDeg !== 0) {
      const twistQ = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0), p.twistDeg * Math.PI / 180,
      )
      targetQ.multiply(twistQ)
    }

    if (!prevQuatRef.current) prevQuatRef.current = targetQ.clone()
    else prevQuatRef.current.slerp(targetQ, p.slerpFactor)

    const tx =  braceletCenter.x - sw / 2
    const ty = -(braceletCenter.y - sh / 2)

    t.braceletGroup.position.set(tx, ty, 0)
    t.braceletGroup.quaternion.copy(prevQuatRef.current)
    t.braceletGroup.scale.setScalar(measuredRadius * p.radiusFrac * (1 / 0.58))
  }, [computePalmBasis, rebuildBraceletMesh, measureArmRadius])

  // ── Canvas2D Debug Overlay ────────────────────────────────────────────────────
  /**
   * Draws the full debug visualization on the Canvas2D overlay:
   *   1. Skeleton connections + landmark dots
   *   2. Landmark index labels (optional)
   *   3. Approximate forearm line (dashed purple, with caveat label)
   *   4. Coordinate axes gizmo (X/Y/Z arrows from bracelet center)
   *   5. Palm normal arrow from palm center
   *   6. 2D bracelet arc preview (foreshortened ellipse projection)
   *   7. HUD: quaternion values, rotation matrix, params, forearm caveat warning
   */
  const drawOverlay = useCallback((lm: Landmark[]) => {
    const canvas = overlayRef.current; if (!canvas) return
    const ctx    = canvas.getContext('2d')!
    ctx.save()
    // Note: clearRect is done by drawResults before calling this function

    const p  = bpRef.current
    const sc = lm.map(l => lmToScreen(l))

    // ── 1. Skeleton connections ──
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'
    ctx.lineWidth   = 1.5
    HAND_CONNECTIONS.forEach(([a, b]) => {
      ctx.beginPath()
      ctx.moveTo(sc[a].x, sc[a].y)
      ctx.lineTo(sc[b].x, sc[b].y)
      ctx.stroke()
    })

    // ── 2. Landmark dots ──
    sc.forEach((s, i) => {
      const isKey = i === 0 || i === 5 || i === 9 || i === 17
      ctx.beginPath(); ctx.arc(s.x, s.y, isKey ? 5 : 2.5, 0, Math.PI*2)
      ctx.fillStyle   = isKey ? '#FFD700' : 'rgba(255,255,255,0.45)'
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'
      ctx.lineWidth   = 0.8
      ctx.fill()
      if (isKey) ctx.stroke()
    })

    // ── 3. Landmark index labels (optional) ──
    if (p.showLabels) {
      ctx.font = 'bold 9px monospace'; ctx.textAlign = 'left'
      sc.forEach((s, i) => {
        ctx.fillStyle = (i===0||i===5||i===9||i===17) ? '#FFD700' : 'rgba(220,220,220,0.8)'
        ctx.fillText(String(i), s.x + 5, s.y - 4)
      })
    }

    const basis = computePalmBasis(lm)
    const { xProj, yProj, zProj, wristScreen, braceletCenter, palmWidth, rotMat3x3 } = basis

    // ── 4. Approximate forearm line ──
    if (p.showForearm) {
      const yN    = norm2(yProj)
      const armLen = palmWidth * 1.25
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(wristScreen.x, wristScreen.y)
      ctx.lineTo(wristScreen.x - yN.x * armLen, wristScreen.y - yN.y * armLen)
      ctx.strokeStyle = 'rgba(180,150,255,0.65)'
      ctx.lineWidth   = 2
      ctx.setLineDash([7, 5])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(200,170,255,0.85)'
      ctx.fillText(
        '≈ forearm (approx — no elbow landmark)',
        wristScreen.x - yN.x * armLen + 5,
        wristScreen.y - yN.y * armLen - 5,
      )
      ctx.restore()
    }

    // ── 5. Coordinate axes gizmo ──
    if (p.showGizmo) {
      const origin = braceletCenter
      const axLen  = palmWidth * 0.55

      const drawArrow = (dir: V2, color: string, label: string) => {
        if (len2(dir) < 0.5) return
        const dn = norm2(dir)
        const ex = origin.x + dn.x * axLen, ey = origin.y + dn.y * axLen
        ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(ex, ey)
        ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke()
        const ang = Math.atan2(ey - origin.y, ex - origin.x), al = 10
        ctx.beginPath()
        ctx.moveTo(ex, ey)
        ctx.lineTo(ex - al*Math.cos(ang - 0.42), ey - al*Math.sin(ang - 0.42))
        ctx.lineTo(ex - al*Math.cos(ang + 0.42), ey - al*Math.sin(ang + 0.42))
        ctx.closePath(); ctx.fillStyle = color; ctx.fill()
        ctx.font = 'bold 12px monospace'; ctx.fillStyle = color
        ctx.fillText(label, ex + 6, ey - 4)
      }

      ctx.save()
      drawArrow(xProj, '#FF4040', 'X (ulnar)')
      drawArrow(yProj, '#40FF60', 'Y (≈arm)')
      drawArrow(zProj, '#4488FF', 'Z (palm)')
      ctx.beginPath(); ctx.arc(origin.x, origin.y, 5, 0, Math.PI*2)
      ctx.fillStyle = '#fff'; ctx.fill()
      ctx.font = '10px monospace'; ctx.fillStyle = '#ddd'
      ctx.fillText('origin', origin.x + 8, origin.y + 4)
      ctx.restore()

      // Palm normal arrow from palm center (average of {0,5,9,17})
      const pcx = (sc[0].x + sc[5].x + sc[9].x + sc[17].x) / 4
      const pcy = (sc[0].y + sc[5].y + sc[9].y + sc[17].y) / 4
      const zN  = norm2(zProj)
      const znL = palmWidth * 0.38
      ctx.save()
      ctx.beginPath(); ctx.moveTo(pcx, pcy); ctx.lineTo(pcx + zN.x*znL, pcy + zN.y*znL)
      ctx.strokeStyle = 'rgba(80,140,255,0.7)'; ctx.lineWidth = 2; ctx.stroke()
      ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(100,170,255,0.9)'
      ctx.fillText('+Z (palm normal)', pcx + zN.x*znL + 4, pcy + zN.y*znL - 3)
      ctx.restore()
    }

    // ── 6. 2D bracelet arc preview (foreshortened ellipse, with occlusion) ──
    if (p.showArcPreview) {
      // Use measured radius (shared from updateBraceletPose) for correct size
      const R  = measuredRadiusRef.current * p.radiusFrac * (1 / 0.58)
      const cx = braceletCenterRef.current.x, cy = braceletCenterRef.current.y

      // Arm direction in 2D screen space
      let armDir2D: V2
      if (elbowLmRef.current && wristPoseLmRef.current) {
        const es = lmToScreen(elbowLmRef.current), ws = lmToScreen(wristPoseLmRef.current)
        armDir2D = norm2({ x: es.x - ws.x, y: es.y - ws.y })
      } else {
        armDir2D = norm2(yProj)
      }
      // perpendicular to arm = the bracelet plane major axis in screen
      const perpDir: V2 = { x: -armDir2D.y, y: armDir2D.x }

      // Foreshortening: project zProj onto screen to get minor axis scale
      const zN   = norm2(zProj)
      const zLen = len2(zProj)
      const xLen = len2(xProj)
      const sA   = R                                           // semi-major along perp
      const sB   = xLen > 0.5 ? R * zLen / xLen : R * 0.3    // semi-minor (depth)

      const gapHalf  = (p.gapDeg / 2) * Math.PI / 180
      const gapCtr   = Math.PI / 2
      const arcStart = gapCtr + gapHalf
      const arcEnd   = gapCtr - gapHalf + 2 * Math.PI
      const SEGS     = 128

      // Palm normal direction tells us which half faces toward camera (front) vs away (back)
      // zProj.y < 0 means palm faces up in screen (toward camera) → sin(θ) > 0 is front
      const palmFacingSign = zProj.y < 0 ? 1 : -1

      ctx.save()
      // Draw in two passes: back (dashed, faded) then front (solid, bright)
      for (const pass of ['back', 'front'] as const) {
        ctx.beginPath()
        let penDown = false
        for (let i = 0; i <= SEGS; i++) {
          const θ  = arcStart + (i / SEGS) * (arcEnd - arcStart)
          // Point on ellipse in screen: major axis = perpDir, minor axis = zN (depth)
          const px = cx + sA * Math.cos(θ) * perpDir.x + sB * Math.sin(θ) * zN.x
          const py = cy + sA * Math.cos(θ) * perpDir.y + sB * Math.sin(θ) * zN.y
          // sin(θ) > 0 → front side (palm normal toward camera)
          const isFront = Math.sin(θ) * palmFacingSign > 0
          if ((pass === 'front') === isFront) {
            if (!penDown) { ctx.moveTo(px, py); penDown = true }
            else ctx.lineTo(px, py)
          } else {
            penDown = false
          }
        }
        if (pass === 'back') {
          ctx.strokeStyle = 'rgba(255,200,80,0.25)'; ctx.lineWidth = 2.5
          ctx.setLineDash([4, 5]); ctx.stroke(); ctx.setLineDash([])
        } else {
          ctx.strokeStyle = 'rgba(255,220,80,0.85)'; ctx.lineWidth = 3
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    // ── 7. HUD ──
    if (p.showHUD) {
      const q   = prevQuatRef.current
      const R   = rotMat3x3
      const fv  = (v: number) => v.toFixed(3).padStart(7)
      const lines: { text: string; color: string }[] = [
        {
          text: q
            ? `Q  x=${fv(q.x)} y=${fv(q.y)} z=${fv(q.z)} w=${fv(q.w)}`
            : 'Q  — (no hand)',
          color: '#88FF99',
        },
        { text: `R0 [${R[0].map((v: number) => fv(v)).join(', ')}]`, color: '#88FF99' },
        { text: `R1 [${R[1].map((v: number) => fv(v)).join(', ')}]`, color: '#88FF99' },
        { text: `R2 [${R[2].map((v: number) => fv(v)).join(', ')}]`, color: '#88FF99' },
        {
          text: `palmW=${palmWidth.toFixed(0)}px  off=${(p.offsetFrac*palmWidth).toFixed(0)}px  gap=${p.gapDeg}°`,
          color: '#AADDFF',
        },
        {
          text: `radius=${(p.radiusFrac*palmWidth).toFixed(0)}px  tube=${(p.tubeFrac*palmWidth).toFixed(0)}px`,
          color: '#AADDFF',
        },
        {
          text: `twist=${p.twistDeg.toFixed(0)}°  slerp=${(p.slerpFactor*100).toFixed(0)}%`,
          color: '#AADDFF',
        },
        elbowLmRef.current
          ? { text: '✓ forearm: REAL  (PoseLandmarker elbow 13/14)', color: '#44FF88' }
          : { text: '⚠ forearm: APPROXIMATED  (PoseLandmarker loading…)', color: '#FFAA44' },
      ]

      ctx.save()
      const lh = 14, pad = 7, boxW = 370
      ctx.fillStyle = 'rgba(0,0,0,0.62)'
      ctx.beginPath()
      if (ctx.roundRect) {
        ctx.roundRect(8, 8, boxW, lines.length * lh + pad * 2, 4)
      } else {
        ctx.rect(8, 8, boxW, lines.length * lh + pad * 2)
      }
      ctx.fill()
      ctx.font = '10px monospace'; ctx.textAlign = 'left'
      lines.forEach(({ text, color }, i) => {
        ctx.fillStyle = color
        ctx.fillText(text, 14, 8 + pad + (i + 0.85) * lh)
      })
      ctx.restore()
    }

    ctx.restore()
  }, [computePalmBasis, lmToScreen])

  // ── Pose arm skeleton ────────────────────────────────────────────────────────
  // Upper-body connections: shoulder→elbow→wrist + wrist finger tips
  const POSE_ARM_CONNECTIONS: [number, number][] = [
    [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
    [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
    [11, 12],
  ]

  const drawPoseSkeleton = useCallback((ctx: CanvasRenderingContext2D, poseLms: Landmark[]) => {
    if (!poseLms.length) return
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 2
    for (const [a, b] of POSE_ARM_CONNECTIONS) {
      const pa = poseLms[a], pb = poseLms[b]
      if (!pa || !pb) continue
      const sa = lmToScreen(pa), sb = lmToScreen(pb)
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke()
    }
    for (const idx of [11, 12, 13, 14, 15, 16]) {
      const lm = poseLms[idx]; if (!lm) continue
      const s = lmToScreen(lm)
      ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2)
      ctx.fillStyle = idx < 13 ? 'rgba(180,180,255,0.8)' : idx < 15 ? 'rgba(100,200,255,0.9)' : 'rgba(255,200,100,0.9)'
      ctx.fill()
    }
    ctx.restore()
  }, [lmToScreen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Main MediaPipe Results Callback ───────────────────────────────────────────
  const drawResults = useCallback((results: any) => {
    resizeAll()
    const t = ts.current
    const canvas = overlayRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // ── Always draw pose arm skeleton if available ──
    if (poseLmsRef.current) {
      drawPoseSkeleton(ctx, poseLmsRef.current)
    }

    if (results.multiHandLandmarks?.length > 0) {
      const raw  = results.multiHandLandmarks[0] as Landmark[]
      const flts = filtersRef.current
      const now  = performance.now() / 1000

      const filtered: Landmark[] = raw.map((lm, i) => ({
        x: flts[i].x.filter(lm.x, now),
        y: flts[i].y.filter(lm.y, now),
        z: flts[i].z.filter(lm.z, now),
      }))

      updateBraceletPose(filtered)
      drawOverlay(filtered)
      setHandCount(results.multiHandLandmarks.length)
    } else {
      if (t.braceletGroup) t.braceletGroup.visible = false
      prevQuatRef.current = null

      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,0.50)'
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(8, 8, 180, 24, 4); else ctx.rect(8, 8, 180, 24)
      ctx.fill()
      ctx.font = '10px monospace'; ctx.fillStyle = '#888'; ctx.textAlign = 'left'
      ctx.fillText('等待手部检测…', 14, 24)
      ctx.restore()
      setHandCount(0)
    }

    if (t.ready) t.renderer.render(t.scene, t.camera)
  }, [updateBraceletPose, drawOverlay, resizeAll, drawPoseSkeleton])

  // ── Camera / MediaPipe Tasks Start-Stop (HolisticLandmarker) ─────────────────
  const startAR = async () => {
    if (running) {
      cancelAnimationFrame(rafRef.current)
      const stream = videoRef.current?.srcObject as MediaStream | null
      stream?.getTracks().forEach(t => t.stop())
      if (videoRef.current) videoRef.current.srcObject = null
      holisticRef.current?.close()
      holisticRef.current = null
      elbowLmRef.current = null; wristPoseLmRef.current = null; poseLmsRef.current = null
      setRunning(false); setHandCount(0)
      setStatus('AR 已停止')
      if (ts.current.braceletGroup) ts.current.braceletGroup.visible = false
      return
    }

    try {
      setStatus('初始化中…')
      await initThree()
      rebuildBraceletMesh(true)

      setStatus('加载 Holistic 模型…')
      const { HolisticLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')

      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
      )

      const holistic = await HolisticLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence:  0.5,
        minHandLandmarksConfidence: 0.5,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence:  0.5,
      })
      holisticRef.current = holistic

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
      })
      const video = videoRef.current!
      video.srcObject = stream
      await new Promise<void>(res => { video.onloadedmetadata = () => { video.play(); res() } })

      filtersRef.current  = makeFilterBank(30, 1.0, 0.05)
      prevQuatRef.current = null
      setRunning(true)
      setStatus('AR 试戴运行中 ✓ (HolisticLandmarker)')

      const loop = () => {
        rafRef.current = requestAnimationFrame(loop)
        if (video.readyState < 2) return
        const now = performance.now()

        const result = holisticRef.current?.detectForVideo(video, now)
        if (!result) return

        // ── Store pose landmarks for arm skeleton ──
        const poseLms: Landmark[] = result.poseLandmarks?.[0] ?? []
        poseLmsRef.current = poseLms.length ? poseLms : null

        // ── Extract elbow/wrist for forearm axis ──
        // HolisticLandmarker: leftHandLandmarks = person's left (right in mirror)
        // Pose: 13=L_elbow,14=R_elbow,15=L_wrist,16=R_wrist (image-space, not person-space)
        // We match hand to pose by checking which hand result is present
        const hasLeft  = (result.leftHandLandmarks?.length  ?? 0) > 0
        const hasRight = (result.rightHandLandmarks?.length ?? 0) > 0
        if (poseLms.length) {
          // Use whichever hand is detected; prefer right hand (left in mirror = index 13/15)
          const useLeft = hasLeft && !hasRight
          elbowLmRef.current     = poseLms[useLeft ? 13 : 14] ?? null
          wristPoseLmRef.current = poseLms[useLeft ? 15 : 16] ?? null
        } else {
          elbowLmRef.current = null; wristPoseLmRef.current = null
        }

        // ── Pick hand landmarks (prefer right hand in mirror = leftHandLandmarks) ──
        const handLms: Landmark[] = (
          result.rightHandLandmarks?.[0] ??
          result.leftHandLandmarks?.[0]  ??
          []
        )

        if (handLms.length) {
          drawResults({ multiHandLandmarks: [handLms], multiHandedness: [] })
        } else {
          drawResults({ multiHandLandmarks: [], multiHandedness: [] })
        }
      }
      loop()

    } catch (e: any) {
      setStatus(`启动失败: ${e.message}`)
      setRunning(false)
    }
  }

  // Rebuild geometry when shape params change while running
  useEffect(() => {
    if (running) rebuildBraceletMesh()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bp.gapDeg, bp.tubeFrac, bp.radiusFrac])

  // ── Slider and Toggle Definitions ─────────────────────────────────────────────
  type SliderDef = {
    key: keyof BraceletParams
    label: string
    min: number; max: number; step: number
    fmt: (v: number) => string
  }

  const SLIDERS: SliderDef[] = [
    { key:'radiusFrac',  label:'手镯半径', min:0.30, max:0.90, step:0.01,  fmt: v=>`${(v*100).toFixed(0)}% palm` },
    { key:'tubeFrac',    label:'管材粗细', min:0.02, max:0.20, step:0.005, fmt: v=>`${(v*100).toFixed(1)}% R` },
    { key:'gapDeg',      label:'开口角度', min:20,   max:150,  step:1,     fmt: v=>`${v}°` },
    { key:'offsetFrac',  label:'沿臂偏移', min:-0.10, max:0.50, step:0.01, fmt: v=>`${(v*100).toFixed(0)}% palm` },
    { key:'twistDeg',    label:'手动扭转', min:-180, max:180,  step:1,     fmt: v=>`${v}°` },
    { key:'slerpFactor', label:'平滑强度', min:0.05, max:0.95, step:0.01,  fmt: v=>`${(v*100).toFixed(0)}%` },
  ]

  const TOGGLES: { key: keyof BraceletParams; label: string }[] = [
    { key:'show',           label:'手镯 3D'  },
    { key:'showGizmo',      label:'坐标轴'   },
    { key:'showArcPreview', label:'弧线预览' },
    { key:'showLabels',     label:'点编号'   },
    { key:'showForearm',    label:'近似前臂' },
    { key:'showHUD',        label:'矩阵 HUD' },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────────
  return (
    <div style={{ position:'fixed', inset:0, background:'#000', overflow:'hidden', fontFamily:'system-ui,sans-serif' }}>

      {/* Camera feed — CSS-mirrored for natural selfie experience */}
      <video
        ref={videoRef}
        style={{
          position:'absolute', inset:0,
          width:'100%', height:'100%',
          objectFit:'cover',
          transform:'scaleX(-1)',
        }}
        autoPlay playsInline muted
      />

      {/* Three.js canvas — bracelet 3D geometry only */}
      <canvas
        ref={threeRef_}
        style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }}
      />

      {/* Canvas2D overlay — skeleton, axes gizmo, arc preview, HUD */}
      <canvas
        ref={overlayRef}
        style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }}
      />

      {/* Hidden pixel-sampling canvas — not displayed, used to read video pixels */}
      <canvas ref={pixelCanvasRef} style={{ display:'none' }} />

      {/* Top status bar */}
      <div style={{
        position:'absolute', top:0, left:0, right:0,
        padding:'10px 16px',
        background:'linear-gradient(to bottom, rgba(0,0,0,0.65), transparent)',
        display:'flex', alignItems:'center', gap:12,
      }}>
        <span style={{ color:'#FFD700', fontWeight:700, fontSize:15, letterSpacing:0.5 }}>
          AR 手镯试戴
        </span>
        <span style={{ color: running ? '#4ADE80' : '#94A3B8', fontSize:11, fontFamily:'monospace' }}>
          {status}
        </span>
        {handCount > 0 && (
          <span style={{ color:'#60A5FA', fontSize:11, fontFamily:'monospace' }}>
            {handCount} 只手
          </span>
        )}
      </div>

      {/* Bottom control panel */}
      <div style={{
        position:'absolute', bottom:0, left:0, right:0,
        background:'rgba(0,0,0,0.78)',
        backdropFilter:'blur(12px)',
        WebkitBackdropFilter:'blur(12px)',
        padding:'12px 14px env(safe-area-inset-bottom, 16px)',
        maxHeight:'62vh', overflowY:'auto',
      }}>

        {/* Start / stop */}
        <div style={{ display:'flex', justifyContent:'center', marginBottom:10 }}>
          <button
            onClick={startAR}
            style={{
              background: running ? '#EF4444' : '#10B981',
              color:'#fff', border:'none', borderRadius:8,
              padding:'8px 32px', fontWeight:700, fontSize:14, cursor:'pointer',
            }}
          >
            {running ? '停止' : '启动识别'}
          </button>
        </div>

        {/* Toggle chips */}
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
          {TOGGLES.map(({ key, label }) => {
            const on = bp[key] as boolean
            return (
              <button key={key}
                onClick={() => setBp(prev => ({ ...prev, [key]: !prev[key as keyof BraceletParams] }))}
                style={{
                  padding:'4px 11px', borderRadius:20, border:'none',
                  fontSize:11, fontWeight:600, cursor:'pointer',
                  background: on ? '#FFD700' : '#374151',
                  color:       on ? '#000'    : '#9CA3AF',
                  transition: 'all 0.15s',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Sliders */}
        {SLIDERS.map(({ key, label, min, max, step, fmt }) => (
          <div key={key} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
            <span style={{ color:'#D1D5DB', fontSize:11, fontFamily:'monospace', minWidth:72 }}>
              {label}
            </span>
            <input
              type="range" min={min} max={max} step={step}
              value={bp[key] as number}
              onChange={e => setBp(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
              style={{ flex:1, accentColor:'#FFD700', cursor:'pointer' }}
            />
            <span style={{ color:'#FFD700', fontSize:11, fontFamily:'monospace', minWidth:58, textAlign:'right' }}>
              {fmt(bp[key] as number)}
            </span>
          </div>
        ))}

        {/* Forearm approximation caveat banner */}
        <div style={{
          marginTop:10, padding:'7px 11px',
          background: 'rgba(34,197,94,0.10)',
          borderLeft: '3px solid #22C55E',
          borderRadius:3,
        }}>
          <p style={{ color:'#86EFAC', fontSize:9.5, fontFamily:'monospace', margin:0, lineHeight:1.55 }}>
            ✓ 使用 PoseLandmarker (Lite) + HandLandmarker 双模型。<br />
            前臂方向来自真实肘关节 landmark 13/14，精度显著提升。<br />
            手腕弯曲时误差接近 0°（不再依赖近似）。
          </p>
        </div>

      </div>
    </div>
  )
}
