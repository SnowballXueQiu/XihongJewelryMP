import { useEffect, useMemo, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Switch, Text, View } from '@tarojs/components'
import { fetchProduct } from '@/services/api'
import { usePageEntranceAnimation } from '@/hooks/useSubtleAnimation'
import { Product } from '@/types/domain'
import './index.scss'

const FINGER_OPTIONS = [
  { label: '食指', value: 7 },
  { label: '中指', value: 11 },
  { label: '无名指', value: 15 },
  { label: '小指', value: 19 },
]

export default function ArTryOnPage() {
  const router = useRouter()
  const [product, setProduct] = useState<Product | null>(null)
  const [fingerSync, setFingerSync] = useState(11)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [trackerReady, setTrackerReady] = useState(false)
  const [handLandmarks, setHandLandmarks] = useState<Array<{ x: number; y: number; z: number }>>([])
  const handConnections = useMemo(() => [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
  ], [])
  const skeletonOverlay = useMemo(() => {
    if (handLandmarks.length !== 21) return { points: [], lines: [] }

    const xs = handLandmarks.map((point) => point.x)
    const ys = handLandmarks.map((point) => point.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const spanX = Math.max(maxX - minX, 0.001)
    const spanY = Math.max(maxY - minY, 0.001)
    const boxSize = 52
    const offsetX = 50 - boxSize / 2
    const offsetY = 36 - boxSize / 2

    const points = handLandmarks.map((point, index) => ({
      id: index,
      x: offsetX + ((point.x - minX) / spanX) * boxSize,
      y: offsetY + (1 - (point.y - minY) / spanY) * boxSize
    }))
    const lines = handConnections.map(([from, to]) => {
      const start = points[from]
      const end = points[to]
      const dx = end.x - start.x
      const dy = end.y - start.y
      return {
        id: `${from}-${to}`,
        x: start.x,
        y: start.y,
        width: Math.sqrt(dx * dx + dy * dy),
        rotate: Math.atan2(dy, dx) * 180 / Math.PI
      }
    })

    return { points, lines }
  }, [handConnections, handLandmarks])
  const pageAnimation = usePageEntranceAnimation()

  useEffect(() => {
    const id = Number(router.params.id)
    if (id) fetchProduct(id).then(p => {
      setProduct(p)
      if (p) setFingerSync(p.ar_auto_sync)
    })
  }, [router.params.id])

  useEffect(() => {
    Taro.authorize({ scope: 'scope.camera' }).catch(() => {
      Taro.showModal({
        title: '需要相机权限',
        content: 'AR 试戴需要相机权限。请在微信设置中开启后重试。',
        showCancel: false
      })
    })
  }, [])

  if (!product) {
    return <View className='page' animation={pageAnimation}><Text>加载 AR 商品...</Text></View>
  }

  if (!product.supports_ar || !product.ar_model_url) {
    return (
      <View className='page ar-page' animation={pageAnimation}>
        <View className='ar-empty card'>
          <Text>该商品还没有配置 AR 模型。</Text>
        </View>
      </View>
    )
  }

  const isRing = product.category_slug === 'rings'

  return (
    <View className='ar-page' animation={pageAnimation}>
      <View className='ar-stage'>
        <xr-try-on
          className='xr-fullscreen'
          style={{ position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', display: 'block', background: '#000' }}
          width='100vw'
          height='100vh'
          model-url={product.ar_model_url}
          model-scale={product.ar_scale}
          model-rotation={product.ar_rotation}
          model-position={product.ar_position}
          auto-sync={fingerSync}
          debug-skeleton={showSkeleton}
          onTrackerSwitch={(event) => setTrackerReady(Boolean(event.detail?.value))}
          onTrackerDebug={(event) => {
            setTrackerReady(Boolean(event.detail?.active))
            setHandLandmarks(event.detail?.points || [])
          }}
        />
      </View>

      {showSkeleton && (
        <View className='skeleton-layer'>
          {skeletonOverlay.lines.map((line) => (
            <View
              key={line.id}
              className='skeleton-line'
              style={{
                left: `${line.x}vw`,
                top: `${line.y}vh`,
                width: `${line.width}vw`,
                transform: `rotate(${line.rotate}deg)`
              }}
            />
          ))}
          {skeletonOverlay.points.map((point) => (
            <View
              key={point.id}
              className={`skeleton-point ${point.id === 0 ? 'is-root' : ''}`}
              style={{ left: `${point.x}vw`, top: `${point.y}vh` }}
            />
          ))}
          <View className={`tracker-state ${trackerReady ? 'is-active' : ''}`}>
            <Text>{trackerReady ? 'Hand landmarks active' : 'Waiting for hand'}</Text>
          </View>
        </View>
      )}

      <View className='ar-topbar'>
        <Text className='back' onClick={() => Taro.navigateBack()}>‹</Text>
        <Text className='top-title'>AR 试戴</Text>
      </View>

      <View className='ar-panel'>
        <View>
          <Text className='ar-title'>{product.name}</Text>
          <Text className='ar-tip'>请将手放入画面，保持光线充足。真实珠宝模型可替换当前 demo GLB。</Text>
        </View>
        {isRing && (
          <View className='finger-picker'>
            <Text className='finger-picker-label'>选择手指</Text>
            <View className='finger-picker-options'>
              {FINGER_OPTIONS.map(opt => (
                <View
                  key={opt.value}
                  className={`finger-option ${fingerSync === opt.value ? 'active' : ''}`}
                  onClick={() => setFingerSync(opt.value)}
                >
                  <Text>{opt.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
        <View className='debug-control'>
          <Text className='debug-label'>骨骼线</Text>
          <Switch color='#B89A63' checked={showSkeleton} onChange={(event) => setShowSkeleton(event.detail.value)} />
        </View>
      </View>
    </View>
  )
}
