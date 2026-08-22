import { useMemo, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Checkbox, Text, View } from '@tarojs/components'
import JewelryVisual from '@/components/JewelryVisual'
import IconFont from '@/components/IconFont'
import LuxuryLoader from '@/components/LuxuryLoader'
import { clearCart, deleteCartItem, fetchCart, fetchStoreConfig, formatMoney, updateCartItem } from '@/services/api'
import { usePageEntranceAnimation } from '@/hooks/useSubtleAnimation'
import { CartItem, StoreConfig } from '@/types/domain'
import './index.scss'

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [storeConfig, setStoreConfig] = useState<StoreConfig>({ company_name_zh: '', company_name_en: '', shipping_fee_cents: 1500, free_shipping_threshold_cents: 100000, pickup_store_name: '', pickup_store_address: '', pickup_store_phone: '' })
  const selectedItems = useMemo(() => items.filter((item) => selectedIds.includes(item.id)), [items, selectedIds])
  const total = useMemo(() => selectedItems.reduce((sum, item) => sum + item.subtotal_cents, 0), [selectedItems])
  const pieceCount = useMemo(() => selectedItems.reduce((sum, item) => sum + item.quantity, 0), [selectedItems])
  const selectedFreeShipping = selectedItems.length > 0 && selectedItems.every((item) => item.product.free_shipping)
  const allSelected = items.length > 0 && selectedIds.length === items.length
  const pageAnimation = usePageEntranceAnimation()

  useDidShow(() => {
    loadCart()
  })

  async function loadCart() {
    setLoading(true)
    try {
      const [next, nextStoreConfig] = await Promise.all([fetchCart(), fetchStoreConfig()])
      setItems(next)
      setStoreConfig(nextStoreConfig)
      setSelectedIds((ids) => {
        const validIds = next.map((item) => item.id)
        const kept = ids.filter((id) => validIds.includes(id))
        return kept.length ? kept : validIds
      })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '购物袋加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  async function changeQuantity(item: CartItem, nextQuantity: number) {
    if (nextQuantity < 1 || nextQuantity > item.product.stock) return
    setLoadingId(item.id)
    try {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, quantity: nextQuantity, subtotal_cents: entry.product.price_cents * nextQuantity } : entry))
      const next = await updateCartItem(item.id, nextQuantity)
      setItems(next)
    } catch (error) {
      await loadCart()
      Taro.showToast({ title: error instanceof Error ? error.message : '更新失败', icon: 'none' })
    } finally {
      setLoadingId(null)
    }
  }

  async function removeItem(itemId: number) {
    const modal = await Taro.showModal({ title: '移出购物袋？', content: '这件珠宝仍可以在商品页重新加入。', confirmText: '移出', confirmColor: '#7A2630' })
    if (!modal.confirm) return
    setLoadingId(itemId)
    try {
      const next = await deleteCartItem(itemId)
      setItems(next)
      setSelectedIds((ids) => ids.filter((id) => id !== itemId))
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '删除失败', icon: 'none' })
    } finally {
      setLoadingId(null)
    }
  }

  async function clearAll() {
    const modal = await Taro.showModal({ title: '清空购物袋？', content: '将移出全部已选珠宝。', confirmText: '清空', confirmColor: '#7A2630' })
    if (!modal.confirm) return
    await clearCart()
    setItems([])
    setSelectedIds([])
  }

  function toggleSelected(itemId: number) {
    setSelectedIds((ids) => ids.includes(itemId) ? ids.filter((id) => id !== itemId) : [...ids, itemId])
  }

  function checkout() {
    if (!selectedItems.length) {
      Taro.showToast({ title: '请选择要结算的珠宝', icon: 'none' })
      return
    }
    const encoded = encodeURIComponent(JSON.stringify(selectedItems.map((item) => ({ product_id: item.product.id, quantity: item.quantity }))))
    Taro.navigateTo({ url: `/pages/order-confirm/index?items=${encoded}` })
  }

  return (
    <View className='page cart-page' animation={pageAnimation}>
      <View className='cart-head'>
        <View><Text className='cart-eyebrow'>YOUR SELECTION</Text><Text className='cart-title'>购物袋</Text></View>
        {items.length > 0 && <Button className='cart-clear' onClick={clearAll}>清空</Button>}
      </View>

      {!loading && items.length > 0 && (
        <View className='shipping-card'>
          <Text>{selectedFreeShipping || total >= storeConfig.free_shipping_threshold_cents ? '已享顺丰保价包邮' : `再选 ${formatMoney(storeConfig.free_shipping_threshold_cents - total)} 即享包邮`}</Text>
          <View className='shipping-track'><View className='shipping-progress' style={{ width: `${selectedFreeShipping ? 100 : Math.min(100, total / Math.max(1, storeConfig.free_shipping_threshold_cents) * 100)}%` }} /></View>
        </View>
      )}

      {loading ? (
        <LuxuryLoader label='正在打开购物袋' />
      ) : items.length === 0 ? (
        <View className='cart-empty'>
          <View className='empty-bag'><IconFont name='cart' /></View>
          <Text className='empty-title'>购物袋还是空的</Text>
          <Text className='empty-copy'>慢慢挑选。值得珍藏的作品，也值得一次从容的相遇。</Text>
          <Button className='empty-action' hoverClass='button-press' onClick={() => Taro.switchTab({ url: '/pages/products/index' })}>探索珠宝</Button>
        </View>
      ) : (
        <View className='cart-list'>
          {items.map((item, index) => (
            <View key={item.id} className='cart-item' style={{ animationDelay: `${index * 45}ms` }}>
              <Checkbox className='cart-check' value={String(item.id)} checked={selectedIds.includes(item.id)} color='#7A2630' onClick={() => toggleSelected(item.id)} />
              <View className='cart-visual' onClick={() => Taro.navigateTo({ url: `/pages/product-detail/index?id=${item.product.id}` })}>
                <JewelryVisual product={item.product} compact={false} showLabel={false} />
              </View>
              <View className='cart-info'>
                <Text className='cart-material'>{item.product.material}</Text>
                <Text className='cart-name'>{item.product.name}</Text>
                <Text className='cart-subtitle'>{item.product.subtitle}</Text>
                <Text className='cart-price'>{formatMoney(item.product.price_cents)}</Text>
                <View className='item-actions'>
                  <View className='quantity-row'>
                    <Button disabled={loadingId === item.id || item.quantity <= 1} onClick={() => changeQuantity(item, item.quantity - 1)}><IconFont name='minus' /></Button>
                    <Text>{item.quantity}</Text>
                    <Button disabled={loadingId === item.id || item.quantity >= item.product.stock} onClick={() => changeQuantity(item, item.quantity + 1)}><IconFont name='plus' /></Button>
                  </View>
                  <Button className='remove-btn' disabled={loadingId === item.id} onClick={() => removeItem(item.id)}>移出</Button>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {items.length > 0 && (
        <View className='cart-footer'>
          <View className='footer-select' onClick={() => setSelectedIds(allSelected ? [] : items.map((item) => item.id))}>
            <Checkbox value='all' checked={allSelected} color='#7A2630' /><Text>全选</Text>
          </View>
          <View className='footer-total'><Text>{pieceCount} 件 · 合计</Text><Text>{formatMoney(total)}</Text></View>
          <Button className='checkout' hoverClass='button-press' onClick={checkout}>去结算</Button>
        </View>
      )}
    </View>
  )
}
