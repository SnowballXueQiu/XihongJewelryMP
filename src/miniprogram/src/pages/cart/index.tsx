import { useEffect, useMemo, useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { fetchCart, formatMoney } from '@/services/api'
import { CartItem } from '@/types/domain'
import './index.scss'

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>([])
  const total = useMemo(() => items.reduce((sum, item) => sum + item.subtotal_cents, 0), [items])

  useEffect(() => {
    fetchCart().then(setItems)
  }, [])

  function checkout() {
    const orderItems = items.map((item) => ({ product_id: item.product.id, quantity: item.quantity }))
    const encoded = encodeURIComponent(JSON.stringify(orderItems))
    Taro.navigateTo({ url: `/pages/order-confirm/index?items=${encoded}` })
  }

  return (
    <View className='page cart-page'>
      {items.length === 0 ? (
        <View className='empty card'>
          <Text>购物车为空</Text>
          <Button className='primary-btn empty-btn' onClick={() => Taro.switchTab({ url: '/pages/products/index' })}>去选购</Button>
        </View>
      ) : (
        <>
          {items.map((item) => (
            <View key={item.id} className='cart-item card'>
              <View className='cart-image' style={{ background: item.product.image_color }} />
              <View className='cart-info'>
                <Text className='cart-name'>{item.product.name}</Text>
                <Text className='cart-subtitle'>数量 x {item.quantity}</Text>
                <Text className='cart-price'>{formatMoney(item.subtotal_cents)}</Text>
              </View>
            </View>
          ))}
          <View className='cart-footer'>
            <Text className='total'>合计 {formatMoney(total)}</Text>
            <Button className='primary-btn checkout' onClick={checkout}>结算</Button>
          </View>
        </>
      )}
    </View>
  )
}
