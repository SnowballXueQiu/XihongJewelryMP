import { useEffect, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
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
          model-url={product.ar_model_url}
          model-scale={product.ar_scale}
          model-rotation={product.ar_rotation}
          model-position={product.ar_position}
          auto-sync={fingerSync}
        />
      </View>
      <View className='ar-panel'>
        <Text className='ar-title'>{product.name}</Text>
        <Text className='ar-tip'>请将手放入画面，保持光线充足。真实珠宝模型可替换当前 demo GLB。</Text>
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
      </View>
    </View>
  )
}
