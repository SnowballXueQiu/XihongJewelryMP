import { useEffect, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { addToCart, fetchProduct, formatMoney } from '@/services/api'
import { Product } from '@/types/domain'
import './index.scss'

export default function ProductDetailPage() {
  const router = useRouter()
  const [product, setProduct] = useState<Product | null>(null)

  useEffect(() => {
    const id = Number(router.params.id)
    if (id) fetchProduct(id).then(setProduct)
  }, [router.params.id])

  async function handleAddCart() {
    if (!product) return
    await addToCart(product.id, 1)
    Taro.showToast({ title: '已加入购物车', icon: 'success' })
  }

  function buyNow() {
    if (!product) return
    const items = encodeURIComponent(JSON.stringify([{ product_id: product.id, quantity: 1 }]))
    Taro.navigateTo({ url: `/pages/order-confirm/index?items=${items}` })
  }

  if (!product) {
    return <View className='page'><Text>加载中...</Text></View>
  }

  return (
    <View className='page detail-page'>
      <View className='detail-image' style={{ background: product.image_color }}>
        {product.supports_ar && <Text className='ar-tag'>支持 AR 试戴</Text>}
      </View>
      <View className='detail-main'>
        <Text className='name'>{product.name}</Text>
        <Text className='subtitle'>{product.subtitle}</Text>
        <Text className='price'>{formatMoney(product.price_cents)}</Text>
        <View className='meta-grid'>
          <View className='meta-item'><Text>材质</Text><Text>{product.material}</Text></View>
          <View className='meta-item'><Text>库存</Text><Text>{product.stock}</Text></View>
        </View>
        <Text className='description'>{product.description}</Text>
      </View>

      {product.supports_ar && (
        <Button className='secondary-btn wide' onClick={() => Taro.navigateTo({ url: `/pages/ar-try-on/index?id=${product.id}` })}>
          AR 试戴
        </Button>
      )}
      <View className='action-row'>
        <Button className='ghost-btn action' onClick={handleAddCart}>加入购物车</Button>
        <Button className='primary-btn action' onClick={buyNow}>立即购买</Button>
      </View>
    </View>
  )
}
