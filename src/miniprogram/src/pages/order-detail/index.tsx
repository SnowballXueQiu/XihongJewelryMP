import { useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { cancelOrder, completeOrder, fetchOrder, formatMoney, orderStatusLabel } from '@/services/api'
import { performOrderPayment } from '@/services/payment'
import { Order } from '@/types/domain'
import './index.scss'

const statusCopy: Record<string, string> = {
  pending_payment: '为你保留库存，请在订单关闭前完成支付', paid: '款项已确认，店员即将开始为你备货', preparing: '作品正在仔细质检与包装', shipped: '作品已交付物流，请留意签收', completed: '感谢你的珍藏，愿它陪伴每个重要时刻', cancelled: '订单已取消，库存与优惠券已退回', refunding: '退款正在处理中', refunded: '款项已按原支付路径退回', failed: '支付状态异常，请联系客户服务'
}

export default function OrderDetailPage() {
  const id = Number(useRouter().params.id || 0)
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)

  async function load() {
    try { setOrder(await fetchOrder(id)) } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '订单加载失败', icon: 'none' })
    } finally { setLoading(false) }
  }
  useDidShow(() => { load() })

  async function pay() {
    if (!order) return
    setActing(true)
    try {
      const result = await performOrderPayment(order.id)
      if (result !== 'cancelled') Taro.redirectTo({ url: `/pages/payment-result/index?orderId=${order.id}&result=${result}` })
    } catch (error) { Taro.showToast({ title: error instanceof Error ? error.message : '支付发起失败', icon: 'none' }) }
    finally { setActing(false) }
  }

  async function cancel() {
    if (!order) return
    const modal = await Taro.showModal({ title: '取消订单', content: '确定取消这笔订单吗？', confirmColor: '#74252D' })
    if (!modal.confirm) return
    setActing(true)
    try { setOrder(await cancelOrder(order.id)) } catch (error) { Taro.showToast({ title: error instanceof Error ? error.message : '取消失败', icon: 'none' }) }
    finally { setActing(false) }
  }

  async function receive() {
    if (!order) return
    const modal = await Taro.showModal({ title: '确认收货', content: '请确认作品已经安全送达。', confirmColor: '#74252D' })
    if (!modal.confirm) return
    setActing(true)
    try { setOrder(await completeOrder(order.id)) } catch (error) { Taro.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' }) }
    finally { setActing(false) }
  }

  if (loading) return <View className='detail-loading'><View /></View>
  if (!order) return <View className='detail-missing'><Text>订单不存在</Text></View>

  return (
    <View className='order-detail-page'>
      <View className={`status-hero hero-${order.status}`}><Text>ORDER STATUS</Text><Text>{orderStatusLabel[order.status]}</Text><Text>{statusCopy[order.status]}</Text><View className='status-ring' /></View>
      {order.logistics_company && <View className='detail-block logistics' onClick={() => order.tracking_no && Taro.setClipboardData({ data: order.tracking_no })}>
        <View className='block-title'><Text>物流进度</Text><Text>复制单号 〉</Text></View><Text>{order.logistics_company}</Text><Text>{order.tracking_no}</Text>
      </View>}
      <View className='detail-block address'><View className='block-title'><Text>收货信息</Text><Text>DELIVERY</Text></View><Text>{order.receiver_name} · {order.receiver_phone}</Text><Text>{order.receiver_address}</Text></View>
      <View className='detail-block'><View className='block-title'><Text>作品清单</Text><Text>{order.items.length} 款</Text></View>
        {order.items.map((item) => <View className='detail-item' key={`${item.product_id}-${item.product_name}`} onClick={() => Taro.navigateTo({ url: `/pages/product-detail/index?id=${item.product_id}` })}><View className='item-gem'>{item.product_name.slice(0, 1)}</View><View><Text>{item.product_name}</Text><Text>{formatMoney(item.unit_price_cents)} × {item.quantity}</Text></View><Text>{formatMoney(item.unit_price_cents * item.quantity)}</Text></View>)}
      </View>
      <View className='detail-block amount-block'>
        <View><Text>商品小计</Text><Text>{formatMoney(order.subtotal_cents)}</Text></View><View><Text>配送费</Text><Text>{order.shipping_fee_cents ? formatMoney(order.shipping_fee_cents) : '包邮'}</Text></View><View><Text>优惠</Text><Text>-{formatMoney(order.discount_cents)}</Text></View><View className='grand-total'><Text>实付金额</Text><Text>{formatMoney(order.total_cents)}</Text></View>
      </View>
      {order.buyer_note && <View className='detail-block note'><Text>订单备注</Text><Text>{order.buyer_note}</Text></View>}
      <View className='detail-meta'><Text>订单编号 {order.order_no}</Text><Text>下单时间 {order.created_at?.replace('T', ' ').slice(0, 19)}</Text>{order.paid_at && <Text>支付时间 {order.paid_at.replace('T', ' ').slice(0, 19)}</Text>}</View>
      <View className='detail-service'><Text>需要帮助？</Text><Button openType='contact'>联系专属顾问</Button></View>
      {(order.can_pay || order.can_cancel || order.status === 'shipped') && <View className='detail-footer'>{order.can_cancel && <Button disabled={acting} onClick={cancel}>取消订单</Button>}{order.status === 'shipped' && <Button className='strong' disabled={acting} onClick={receive}>确认收货</Button>}{order.can_pay && <Button className='strong' loading={acting} onClick={pay}>微信支付</Button>}</View>}
    </View>
  )
}
