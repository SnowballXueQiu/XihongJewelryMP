'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './page.module.css'

type DebugState = {
  hand: 'all' | 'right' | 'left'
  part: 'all' | 'wrist' | 'thumb' | 'index' | 'middle' | 'ring' | 'pinky'
  model: string
}

type Landmark = { x: number; y: number; z: number }

const FINGER_PARTS: Record<string, { connectors: number[][]; points: number[] }> = {
  wrist: { connectors: [[0, 1], [0, 5], [0, 17]], points: [0] },
  thumb: { connectors: [[0, 1], [1, 2], [2, 3], [3, 4]], points: [1, 2, 3, 4] },
  index: { connectors: [[0, 5], [5, 6], [6, 7], [7, 8]], points: [5, 6, 7, 8] },
  middle: { connectors: [[0, 9], [9, 10], [10, 11], [11, 12]], points: [9, 10, 11, 12] },
  ring: { connectors: [[0, 13], [13, 14], [14, 15], [15, 16]], points: [13, 14, 15, 16] },
  pinky: { connectors: [[0, 17], [17, 18], [18, 19], [19, 20]], points: [17, 18, 19, 20] },
}

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]

const MODEL_OPTIONS = [
  { label: '手镯 1', value: '/models/bracelet-1.glb' },
  { label: '手镯 2', value: '/models/bracelet-2.glb' },
  { label: '隐藏', value: 'none' },
]

export default function ArPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const skeletonCanvasRef = useRef<HTMLCanvasElement>(null)
  const jewelryCanvasRef = useRef<HTMLCanvasElement>(null)

  const [status, setStatus] = useState('点击启动识别')
  const [statusActive, setStatusActive] = useState(false)
  const [webcamRunning, setWebcamRunning] = useState(false)
  const [handCount, setHandCount] = useState(0)

  const [debug, setDebug] = useState<DebugState>({ hand: 'all', part: 'all', model: '/models/bracelet-1.glb' })

  const threeRef = useRef<any>({
    scene: null, camera: null, renderer: null, loader: null,
    model: null, modelRoot: null, modelBaseScale: 1,
    width: 1, height: 1, ready: false,
  })
  const legacyHandsRef = useRef<any>(null)
  const legacyCameraRef = useRef<any>(null)
  const tryOnHandednessRef = useRef<'right' | 'left'>('right')
  const debugRef = useRef(debug)

  useEffect(() => { debugRef.current = debug }, [debug])

  const setStatusMsg = (text: string, active = false) => {
    setStatus(text)
    setStatusActive(active)
  }

  const loadScript = (src: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
      const s = document.createElement('script')
      s.src = src
      s.crossOrigin = 'anonymous'
      s.onload = () => resolve()
      s.onerror = () => reject(new Error(`加载失败: ${src}`))
      document.head.appendChild(s)
    })

  const resizeCanvases = () => {
    const video = videoRef.current
    if (!video) return
    const w = video.videoWidth || window.innerWidth
    const h = video.videoHeight || window.innerHeight
    const sk = skeletonCanvasRef.current
    if (sk && (sk.width !== w || sk.height !== h)) { sk.width = w; sk.height = h }
    const three = threeRef.current
    if (three.ready && (three.width !== w || three.height !== h)) {
      three.width = w; three.height = h
      three.renderer.setSize(w, h, false)
      three.camera.left = -w / 2; three.camera.right = w / 2
      three.camera.top = h / 2; three.camera.bottom = -h / 2
      three.camera.position.set(0, 0, 400)
      three.camera.near = -1000; three.camera.far = 1000
      three.camera.updateProjectionMatrix()
    }
  }

  const ensureThreeReady = async () => {
    const three = threeRef.current
    if (three.ready) return true
    try {
      const [THREE, { GLTFLoader }] = await Promise.all([
        import('three'),
        import('three/examples/jsm/loaders/GLTFLoader.js'),
      ])
      three.scene = new THREE.Scene()
      three.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
      three.renderer = new THREE.WebGLRenderer({
        canvas: jewelryCanvasRef.current!, alpha: true, antialias: true, preserveDrawingBuffer: false,
      })
      three.loader = new GLTFLoader()
      three.modelRoot = new THREE.Group()
      three.renderer.setClearColor(0x000000, 0)
      three.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      three.scene.add(three.modelRoot)
      three.ready = true
      resizeCanvases()
      return true
    } catch (e: any) {
      setStatusMsg(`Three 初始化失败: ${e.message}`)
      return false
    }
  }

  const loadModel = async (url: string) => {
    const three = threeRef.current
    if (!three.ready || !three.loader) return
    setStatusMsg('加载试戴模型')
    three.loader.load(url, async (gltf: any) => {
      three.modelRoot.clear()
      three.model = gltf.scene
      // normalize
      try {
        const { Box3, Vector3 } = await import('three')
        const b = new Box3().setFromObject(three.model)
        const size = new Vector3(); const center = new Vector3()
        b.getSize(size); b.getCenter(center)
        const maxAxis = Math.max(size.x, size.y, size.z, 0.001)
        three.model.position.sub(center)
        three.modelBaseScale = 1 / maxAxis
      } catch {}
      three.modelRoot.add(three.model)
      three.modelRoot.visible = true
      setStatusMsg('试戴模型已加载', true)
    }, undefined, () => setStatusMsg('模型加载失败'))
  }

  const updateJewelryPose = (landmarks: Landmark[] | null) => {
    const three = threeRef.current
    if (!three.ready || !three.model || !landmarks || landmarks.length < 21 || debugRef.current.model === 'none') {
      if (three.modelRoot) three.modelRoot.visible = false
      return
    }
    three.modelRoot.visible = true
    const wrist = landmarks[0], indexBase = landmarks[5], pinkyBase = landmarks[17], middleBase = landmarks[9]
    const x = (wrist.x - 0.5) * three.width
    const y = (0.5 - wrist.y) * three.height
    const palmWidth = Math.hypot(indexBase.x - pinkyBase.x, indexBase.y - pinkyBase.y) * three.width
    const palmAngle = Math.atan2(indexBase.y - pinkyBase.y, indexBase.x - pinkyBase.x)
    const wristToPalm = Math.atan2(middleBase.y - wrist.y, middleBase.x - wrist.x)
    const scale = Math.max(28, palmWidth * 1.55) * three.modelBaseScale
    try {
      three.modelRoot.position.set(x, y, 0)
      three.modelRoot.rotation.set(78 * (Math.PI / 180), 0, -palmAngle + Math.PI / 2)
      three.modelRoot.scale.setScalar(scale)
      three.modelRoot.position.x -= Math.cos(wristToPalm) * palmWidth * 0.15
      three.modelRoot.position.y += Math.sin(wristToPalm) * palmWidth * 0.15
    } catch {}
  }

  const drawResults = (results: any) => {
    resizeCanvases()
    const canvas = skeletonCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.save(); ctx.clearRect(0, 0, canvas.width, canvas.height)
    const three = threeRef.current

    if (results.multiHandLandmarks?.length) {
      const groups = results.multiHandLandmarks.map((lm: Landmark[], i: number) => {
        const raw = results.multiHandedness?.[i]?.label || 'Unknown'
        return { landmarks: lm, handedness: raw === 'Left' ? 'right' : 'left' }
      })

      groups.forEach(({ landmarks, handedness }: any) => {
        const d = debugRef.current
        const isSelected = d.hand === 'all' || d.hand === handedness
        const drawConn = (connectors: number[][], color: string, lw: number) => {
          connectors.forEach(([a, b]) => {
            ctx.beginPath()
            ctx.moveTo(landmarks[a].x * canvas.width, landmarks[a].y * canvas.height)
            ctx.lineTo(landmarks[b].x * canvas.width, landmarks[b].y * canvas.height)
            ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke()
          })
        }
        const drawPts = (pts: number[], color: string, fill: string, r: number) => {
          pts.forEach(i => {
            ctx.beginPath()
            ctx.arc(landmarks[i].x * canvas.width, landmarks[i].y * canvas.height, r, 0, Math.PI * 2)
            ctx.strokeStyle = color; ctx.fillStyle = fill; ctx.lineWidth = 1
            ctx.fill(); ctx.stroke()
          })
        }

        drawConn(HAND_CONNECTIONS, isSelected ? 'rgba(216,192,138,0.42)' : 'rgba(251,250,247,0.18)', isSelected ? 2 : 1)
        drawPts(Array.from({ length: 21 }, (_, i) => i), 'rgba(251,250,247,0.36)', 'rgba(251,250,247,0.42)', 2)

        if (!isSelected) return
        if (d.part === 'all') {
          drawConn(HAND_CONNECTIONS, '#D8C08A', 4)
          drawPts(Array.from({ length: 21 }, (_, i) => i), '#fff', '#B89A63', 3)
        } else {
          const target = FINGER_PARTS[d.part]
          if (target) {
            drawConn(target.connectors, '#FFD86A', 6)
            drawPts(target.points, '#fff', '#FFCC33', d.part === 'wrist' ? 6 : 4)
          }
        }
      })

      const preferred = debugRef.current.hand === 'all' ? tryOnHandednessRef.current : debugRef.current.hand
      const tryOnHand = groups.find((g: any) => g.handedness === preferred) || groups[0]
      tryOnHandednessRef.current = tryOnHand?.handedness || tryOnHandednessRef.current
      updateJewelryPose(tryOnHand?.landmarks ?? null)
      setHandCount(groups.length)
      setStatusMsg('Hand landmarks active', true)
    } else {
      updateJewelryPose(null)
      setHandCount(0)
      setStatusMsg('Waiting for hand')
    }

    if (three.ready) three.renderer.render(three.scene, three.camera)
    ctx.restore()
  }

  const startCamera = async () => {
    if (webcamRunning) {
      legacyCameraRef.current = null
      legacyHandsRef.current = null
      setWebcamRunning(false)
      setStatusMsg('相机已关闭')
      return
    }

    try {
      setStatusMsg('初始化中...')
      await ensureThreeReady()
      const d = debugRef.current
      if (d.model !== 'none') await loadModel(d.model)

      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js')
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js')
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js')

      const hands = new (window as any).Hands({
        locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
      })
      hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.55, minTrackingConfidence: 0.55 })
      hands.onResults(drawResults)
      legacyHandsRef.current = hands

      const camera = new (window as any).Camera(videoRef.current, {
        onFrame: async () => { await hands.send({ image: videoRef.current }) },
        width: 1280, height: 720,
      })
      legacyCameraRef.current = camera
      setWebcamRunning(true)
      await camera.start()
      setStatusMsg('Hands 引擎已启动', true)
    } catch (e: any) {
      setStatusMsg(`启动失败: ${e.message}`)
      setWebcamRunning(false)
    }
  }

  const handleModelChange = async (value: string) => {
    setDebug(d => ({ ...d, model: value }))
    debugRef.current = { ...debugRef.current, model: value }
    if (value === 'none') {
      if (threeRef.current.modelRoot) threeRef.current.modelRoot.visible = false
      return
    }
    if (threeRef.current.modelRoot) threeRef.current.modelRoot.visible = true
    await ensureThreeReady()
    await loadModel(value)
  }

  const productName = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('title') || '玺鸿珠宝 AR 试戴'
    : '玺鸿珠宝 AR 试戴'

  return (
    <main className={styles.shell}>
      <section className={styles.videoView}>
        <video ref={videoRef} className={styles.webcam} autoPlay playsInline muted />
        <canvas ref={jewelryCanvasRef} className={styles.jewelryCanvas} />
        <canvas ref={skeletonCanvasRef} className={styles.skeletonCanvas} />
      </section>

      <div className={styles.topbar}>
        <span className={styles.title}>AR 试戴</span>
      </div>

      <div className={`${styles.status} ${statusActive ? styles.statusActive : ''}`}>{status}</div>

      {handCount > 0 && (
        <p className={styles.gesture}>{handCount} hand(s) · hands</p>
      )}

      <div className={styles.panel}>
        <div className={styles.panelMain}>
          <span className={styles.productName}>{productName}</span>
          <span className={styles.hint}>把手放入画面，系统会实时识别 21 个手部关键点并绘制骨骼线。</span>
        </div>
        <button className={styles.button} onClick={startCamera}>
          {webcamRunning ? '关闭相机' : '启动识别'}
        </button>

        <div className={styles.debugControls}>
          <div className={styles.controlRow}>
            <span className={styles.controlLabel}>手</span>
            {(['all', 'right', 'left'] as const).map(v => (
              <button key={v} className={`${styles.chip} ${debug.hand === v ? styles.chipActive : ''}`}
                onClick={() => setDebug(d => ({ ...d, hand: v }))}>
                {v === 'all' ? '全部' : v === 'right' ? '右手' : '左手'}
              </button>
            ))}
          </div>

          <div className={styles.controlRow}>
            <span className={styles.controlLabel}>部位</span>
            {(['all', 'wrist', 'thumb', 'index', 'middle', 'ring', 'pinky'] as const).map(v => (
              <button key={v} className={`${styles.chip} ${debug.part === v ? styles.chipActive : ''}`}
                onClick={() => setDebug(d => ({ ...d, part: v }))}>
                {({ all: '全部', wrist: '手腕', thumb: '大拇指', index: '食指', middle: '中指', ring: '无名指', pinky: '小拇指' })[v]}
              </button>
            ))}
          </div>

          <div className={styles.controlRow}>
            <span className={styles.controlLabel}>模型</span>
            {MODEL_OPTIONS.map(o => (
              <button key={o.value} className={`${styles.chip} ${debug.model === o.value ? styles.chipActive : ''}`}
                onClick={() => handleModelChange(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
