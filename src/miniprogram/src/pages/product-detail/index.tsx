import { useEffect, useMemo, useState } from 'react'
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import JewelryVisual from '@/components/JewelryVisual'
import IconFont from '@/components/IconFont'
import { addToCart, fetchFavorites, fetchProduct, fetchStoreConfig, formatMoney, toggleFavorite } from '@/services/api'
import { usePageEntranceAnimation } from '@/hooks/useSubtleAnimation'
import { Product, StoreConfig } from '@/types/domain'
import './index.scss'

export default function ProductDetailPage() {
  const router = useRouter()
  const [product, setProduct] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [favorite, setFavorite] = useState(false)
  const [adding, setAdding] = useState(false)
  const [storeConfig, setStoreConfig] = useState<StoreConfig>({ company_name_zh: '', company_name_en: '', shipping_fee_cents: 1500, free_shipping_threshold_cents: 100000, pickup_store_name: '', pickup_store_address: '', pickup_store_phone: '' })
  const pageAnimation = usePageEntranceAnimation()

  useEffect(() => {
    const id = Number(router.params.id)
    if (!id) return
    fetchProduct(id).then(setProduct).catch(() => Taro.showToast({ title: '商品不存在', icon: 'none' }))
    fetchFavorites().then((items) => setFavorite(items.some((item) => item.product.id === id))).catch(() => undefined)
    fetchStoreConfig().then(setStoreConfig).catch(() => undefined)
  }, [router.params.id])

  useShareAppMessage(() => ({
    title: product ? `${product.name}｜玺鸿珠宝` : '玺鸿珠宝',
    path: `/pages/product-detail/index?id=${product?.id || router.params.id}`
  }))

  const saving = useMemo(() => product && product.original_price_cents > product.price_cents
    ? product.original_price_cents - product.price_cents
    : 0, [product])

  async function handleAddCart() {
    if (!product || adding || product.stock <= 0) return
    setAdding(true)
    try {
      await addToCart(product.id, quantity)
      Taro.vibrateShort({ type: 'light' }).catch(() => undefined)
      Taro.showToast({ title: '已放入购物袋', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '加入失败', icon: 'none' })
    } finally {
      setAdding(false)
    }
  }

  function buyNow() {
    if (!product || product.stock <= 0) return
    const items = encodeURIComponent(JSON.stringify([{ product_id: product.id, quantity }]))
    Taro.navigateTo({ url: `/pages/order-confirm/index?items=${items}` })
  }

  async function favoriteProduct() {
    if (!product) return
    try {
      const result = await toggleFavorite(product.id)
      setFavorite(result.active)
      Taro.vibrateShort({ type: 'light' }).catch(() => undefined)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
    }
  }

  if (!product) {
    return <View className='page detail-page detail-loading' animation={pageAnimation}><View className='detail-skeleton' /><View className='detail-copy-skeleton' /></View>
  }

  return (
    <View className='page detail-page' animation={pageAnimation}>
      <View className='detail-visual-wrap'>
        <JewelryVisual product={product} showLabel />
        <Button className={`detail-favorite ${favorite ? 'active' : ''}`} hoverClass='favorite-press' onClick={favoriteProduct}><IconFont name={favorite ? 'heartFilled' : 'heart'} /></Button>
        <Text className='visual-count'>01 / {Math.max(1, (product.gallery_urls?.length || 0) + 1)}</Text>
      </View>

      <View className='detail-main'>
        <Text className='detail-kicker'>{product.category_slug.toUpperCase()} · {product.material}</Text>
        <Text className='name'>{product.name}</Text>
        <Text className='subtitle'>{product.subtitle}</Text>
        <View className='price-line'>
          <Text className='price'>{formatMoney(product.price_cents)}</Text>
          {product.original_price_cents > product.price_cents && <Text className='original-price'>{formatMoney(product.original_price_cents)}</Text>}
          {saving > 0 && <Text className='saving'>已省 {formatMoney(saving)}</Text>}
        </View>
        <View className='tag-row'>{product.tags.map((tag) => <Text key={tag} className='detail-tag'>{tag}</Text>)}</View>
      </View>

      <View className='detail-divider' />
      <View className='detail-description'>
        <Text className='block-index'>01</Text>
        <View className='block-copy'>
          <Text className='block-title'>作品故事</Text>
          <Text className='description'>{product.description}</Text>
        </View>
      </View>

      <View className='detail-specs'>
        <View className='spec-row'><Text>材质</Text><Text>{product.material}</Text></View>
        <View className='spec-row'><Text>库存</Text><Text>{product.stock > 5 ? '现货，可即刻发出' : product.stock > 0 ? `仅余 ${product.stock} 件` : '暂时售罄'}</Text></View>
        <View className='spec-row'><Text>配送</Text><Text>{product.free_shipping ? '顺丰保价 · 此商品包邮' : `顺丰保价 · 满 ${formatMoney(storeConfig.free_shipping_threshold_cents)} 包邮`}</Text></View>
        <View className='spec-row'><Text>售后</Text><Text>七日无理由 · 终身保养</Text></View>
      </View>

      <View className='quantity-section'>
        <View><Text className='quantity-title'>购买数量</Text><Text className='quantity-hint'>每件作品均附独立首饰盒</Text></View>
        <View className='quantity-stepper'>
          <Button disabled={quantity <= 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))}><IconFont name='minus' /></Button>
          <Text>{quantity}</Text>
          <Button disabled={quantity >= product.stock} onClick={() => setQuantity((value) => Math.min(product.stock, value + 1))}><IconFont name='plus' /></Button>
        </View>
      </View>

      <View className='detail-note'>
        <Text>JEWELRY CARE</Text>
        <Text>避免香水与化学品直接接触，佩戴后以柔软干布轻拭，并单独收纳。</Text>
      </View>

      <View className='detail-actions'>
        <Button className='bag-shortcut' hoverClass='button-press' onClick={() => Taro.switchTab({ url: '/pages/cart/index' })}>购物袋</Button>
        <Button className='add-action' loading={adding} disabled={product.stock <= 0} hoverClass='button-press' onClick={handleAddCart}>加入购物袋</Button>
        <Button className='buy-action' disabled={product.stock <= 0} hoverClass='button-press' onClick={buyNow}>{product.stock > 0 ? '立即购买' : '暂时售罄'}</Button>
      </View>
    </View>
  )
}
