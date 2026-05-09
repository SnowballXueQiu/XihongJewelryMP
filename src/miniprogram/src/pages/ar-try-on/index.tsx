import { useEffect, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import { fetchProduct } from '@/services/api'
import { usePageEntranceAnimation } from '@/hooks/useSubtleAnimation'
import { Product } from '@/types/domain'
import './index.scss'

export default function ArTryOnPage() {
  const router = useRouter()
  const [product, setProduct] = useState<Product | null>(null)
  const pageAnimation = usePageEntranceAnimation()

  useEffect(() => {
    const id = Number(router.params.id)
    if (id) fetchProduct(id).then(setProduct)
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

  return (
    <View className='ar-page' animation={pageAnimation}>
      <View className='ar-stage'>
        <xr-try-on
          model-url={product.ar_model_url}
          model-scale={product.ar_scale}
          model-rotation={product.ar_rotation}
          model-position={product.ar_position}
          auto-sync={product.ar_auto_sync}
        />
      </View>
      <View className='ar-panel'>
        <Text className='ar-title'>{product.name}</Text>
        <Text className='ar-tip'>请将手放入画面，保持光线充足。真实珠宝模型可替换当前 demo GLB。</Text>
      </View>
    </View>
  )
}
