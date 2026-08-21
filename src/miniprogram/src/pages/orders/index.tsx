import { useMemo, useState } from 'react'
import Taro, { useDidShow, usePullDownRefresh, useRouter } from '@tarojs/taro'
import { Button, ScrollView, Text, View } from '@tarojs/components'
import { cancelOrder, completeOrder, fetchOrders, formatMoney, orderStatusLabel } from '@/services/api'
import { performOrderPayment } from '@/services/payment'
import { Order, OrderStatus } from '@/types/domain'
import './index.scss'

type OrderGroup = 'all' | 'pending_payment' | 'processing' | 'shipped' | 'completed'

const tabs: Array<{ key: OrderGroup; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pending_payment', label: '待支付' },
  { key: 'processing', label: '待发货' },
  { key: 'shipped', label: '待收货' },
  { key: 'completed', label: '已完成' }
]

function matchesGroup(status: OrderStatus, group: OrderGroup) {
  if (group === 'all') return true
  if (group === 'processing') return status === 'paid' || status === 'preparing'
  return status === group
}

export default function OrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const initialGroup = tabs.some((tab) => tab.key === router.params.status) ? router.params.status as OrderGroup : 'all'
  const [active, setActive] = useState<OrderGroup>(initialGroup)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(0)

  async function load(showLoading = true) {
    if (showLoading) setLoading(true)
    try {
      setOrders(await fetchOrders())
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '订单加载失败', icon: 'none' })
    } finally {
      setLoading(false)
      Taro.stopPullDownRefresh()
    }
  }

  useDidShow(() => { load() })
  usePullDownRefresh(() => { load(false) })
  const visibleOrders = useMemo(() => orders.filter((order) => matchesGroup(order.status, active)), [orders, active])

  async function pay(order: Order) {
    setActing(order.id)
    try {
      const result = await performOrderPayment(order.id)
      if (result !== 'cancelled') Taro.navigateTo({ url: `/pages/payment-result/index?orderId=${order.id}&result=${result}` })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '支付发起失败', icon: 'none' })
    } finally { setActing(0) }
  }

  async function cancel(order: Order) {
    const modal = await Taro.showModal({ title: '取消订单', content: '取消后库存和优惠券会自动退回，确定继续吗？', confirmColor: '#74252D' })
    if (!modal.confirm) return
    setActing(order.id)
    try { await cancelOrder(order.id); await load(false) } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '取消失败', icon: 'none' })
    } finally { setActing(0) }
  }

  async function receive(order: Order) {
    const modal = await Taro.showModal({ title: '确认收货', content: '请确认已收到并检查商品完好。', confirmColor: '#74252D' })
    if (!modal.confirm) return
    setActing(order.id)
    try { await completeOrder(order.id); await load(false) } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
    } finally { setActing(0) }
  }

  return (
    <View className='orders-page'>
      <View className='orders-head'><Text>ORDER ARCHIVE</Text><Text>我的订单</Text></View>
      <ScrollView scrollX className='order-tabs' showScrollbar={false}>
        <View className='tabs-inner'>{tabs.map((tab) => (
          <Button key={tab.key} className={active === tab.key ? 'tab active' : 'tab'} onClick={() => setActive(tab.key)}>{tab.label}</Button>
        ))}</View>
      </ScrollView>

      <View className='order-list'>
        {loading && [0, 1].map((item) => <View key={item} className='order-skeleton' />)}
        {!loading && visibleOrders.map((order) => (
          <View className='order-card' key={order.id} onClick={() => Taro.navigateTo({ url: `/pages/order-detail/index?id=${order.id}` })}>
            <View className='order-top'><View><Text>{order.order_no}</Text><Text>{order.created_at ? order.created_at.slice(0, 10) : ''}</Text></View><Text className={`status status-${order.status}`}>{orderStatusLabel[order.status]}</Text></View>
            <View className='order-products'>
              {order.items.slice(0, 2).map((item) => <View className='order-product' key={`${item.product_id}-${item.product_name}`}><View className='product-monogram'>{item.product_name.slice(0, 1)}</View><View><Text>{item.product_name}</Text><Text>{formatMoney(item.unit_price_cents)} × {item.quantity}</Text></View></View>)}
              {order.items.length > 2 && <Text className='more-items'>另有 {order.items.length - 2} 件</Text>}
            </View>
            <View className='order-total'><Text>共 {order.items.reduce((sum, item) => sum + item.quantity, 0)} 件</Text><Text>实付</Text><Text>{formatMoney(order.total_cents)}</Text></View>
            {(order.can_pay || order.can_cancel || order.status === 'shipped') && <View className='order-actions' onClick={(event) => event.stopPropagation()}>
              {order.can_cancel && <Button disabled={acting === order.id} onClick={() => cancel(order)}>取消订单</Button>}
              {order.status === 'shipped' && <Button disabled={acting === order.id} onClick={() => receive(order)}>确认收货</Button>}
              {order.can_pay && <Button className='primary' loading={acting === order.id} onClick={() => pay(order)}>立即支付</Button>}
            </View>}
          </View>
        ))}
        {!loading && !visibleOrders.length && <View className='orders-empty'><View className='empty-orbit' /><Text>这里还没有订单</Text><Text>去挑选一件值得长久珍藏的珠宝</Text><Button onClick={() => Taro.switchTab({ url: '/pages/products/index' })}>探索作品</Button></View>}
      </View>
    </View>
  )
}
