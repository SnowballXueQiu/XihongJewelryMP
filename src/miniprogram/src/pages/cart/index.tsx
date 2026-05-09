import { useEffect, useMemo, useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Checkbox, Text, View } from '@tarojs/components'
import { clearCart, deleteCartItem, fetchCart, formatMoney, updateCartItem } from '@/services/api'
import { usePageEntranceAnimation } from '@/hooks/useSubtleAnimation'
import { CartItem } from '@/types/domain'
import './index.scss'

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const selectedItems = useMemo(() => items.filter((item) => selectedIds.includes(item.id)), [items, selectedIds])
  const total = useMemo(() => selectedItems.reduce((sum, item) => sum + item.subtotal_cents, 0), [selectedItems])
  const allSelected = items.length > 0 && selectedIds.length === items.length
  const pageAnimation = usePageEntranceAnimation()

  useEffect(() => {
    loadCart()
  }, [])

  async function loadCart() {
    try {
      const next = await fetchCart()
      setItems(next)
      setSelectedIds((ids) => {
        const validIds = next.map((item) => item.id)
        const kept = ids.filter((id) => validIds.includes(id))
        return kept.length ? kept : validIds
      })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '购物车加载失败', icon: 'none' })
    }
  }

  async function changeQuantity(item: CartItem, nextQuantity: number) {
    if (nextQuantity < 1 || nextQuantity > item.product.stock) {
      Taro.showToast({ title: '库存不足', icon: 'none' })
      return
    }
    setLoadingId(item.id)
    try {
      const next = await updateCartItem(item.id, nextQuantity)
      setItems(next)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '更新失败', icon: 'none' })
    } finally {
      setLoadingId(null)
    }
  }

  async function removeItem(itemId: number) {
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
    try {
      await clearCart()
      setItems([])
      setSelectedIds([])
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '清空失败', icon: 'none' })
    }
  }

  function toggleSelected(itemId: number) {
    setSelectedIds((ids) => ids.includes(itemId) ? ids.filter((id) => id !== itemId) : [...ids, itemId])
  }

  function toggleAll() {
    setSelectedIds(allSelected ? [] : items.map((item) => item.id))
  }

  function checkout() {
    if (!selectedItems.length) {
      Taro.showToast({ title: '请选择要结算的商品', icon: 'none' })
      return
    }
    const orderItems = selectedItems.map((item) => ({ product_id: item.product.id, quantity: item.quantity }))
    const encoded = encodeURIComponent(JSON.stringify(orderItems))
    Taro.navigateTo({ url: `/pages/order-confirm/index?items=${encoded}` })
  }

  return (
    <View className='page cart-page' animation={pageAnimation}>
      {items.length === 0 ? (
        <View className='empty card'>
          <Text>购物车为空</Text>
          <Button className='primary-btn empty-btn' hoverClass='button-press' onClick={() => Taro.switchTab({ url: '/pages/products/index' })}>去选购</Button>
        </View>
      ) : (
        <>
          {items.map((item) => (
            <View key={item.id} className='cart-item card pressable' hoverClass='card-press'>
              <Checkbox className='cart-check' value={String(item.id)} checked={selectedIds.includes(item.id)} color='#111111' onClick={() => toggleSelected(item.id)} />
              <View className='cart-image' style={{ background: item.product.image_color }} />
              <View className='cart-info'>
                <Text className='cart-name'>{item.product.name}</Text>
                <Text className='cart-subtitle'>库存 {item.product.stock}</Text>
                <Text className='cart-price'>{formatMoney(item.subtotal_cents)}</Text>
                <View className='quantity-row'>
                  <Button className='qty-btn' disabled={loadingId === item.id || item.quantity <= 1} onClick={() => changeQuantity(item, item.quantity - 1)}>-</Button>
                  <Text className='qty-value'>{item.quantity}</Text>
                  <Button className='qty-btn' disabled={loadingId === item.id || item.quantity >= item.product.stock} onClick={() => changeQuantity(item, item.quantity + 1)}>+</Button>
                  <Button className='remove-btn' disabled={loadingId === item.id} onClick={() => removeItem(item.id)}>删除</Button>
                </View>
              </View>
            </View>
          ))}
          <View className='cart-footer'>
            <View className='footer-select' onClick={toggleAll}>
              <Checkbox value='all' checked={allSelected} color='#111111' />
              <Text>全选</Text>
            </View>
            <Button className='clear-btn' onClick={clearAll}>清空</Button>
            <Text className='total'>合计 {formatMoney(total)}</Text>
            <Button className='primary-btn checkout' hoverClass='button-press' onClick={checkout}>结算</Button>
          </View>
        </>
      )}
    </View>
  )
}
