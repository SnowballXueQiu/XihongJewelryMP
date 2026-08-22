import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { fetchWechatSyncedOrders, formatMoney, syncWechatInvoice } from '@/services/api'
import { Order } from '@/types/domain'
import IconFont from '@/components/IconFont'
import LuxuryLoader from '@/components/LuxuryLoader'
import { orderDetailUrl } from '@/services/routes'
import './index.scss'

const statusText: Record<string, string> = {
  pending_payment: '待完成支付',
  pending_title: '等待微信发票抬头',
  title_pending_sync: '抬头已提交，待同步',
  title_received: '抬头已同步，待开具',
  issue_accepted: '税务开票处理中',
  issue_failed: '税务开票失败',
  insert_accepted: '发票正在插入微信卡包',
  card_insert_accepted: '发票正在插入微信卡包',
  inserted: '已进入微信卡包',
  discard_accepted: '卡券移除处理中',
  discarded: '卡券已移除（不等于冲红）',
  issued: '电子发票已开具',
  reverse_accepted: '税务冲红处理中',
  reverse_failed: '税务冲红失败',
  partially_reversed: '部分发票已冲红，仍需处理',
  reversed: '电子发票已冲红',
  card_updated: '卡包状态已更新',
  delivery_failed: '发票交付失败',
  delivery_reconciling: '交付结果核验中',
  delivery_submitted: '已提交微信卡包',
  delivery_rejected: '微信拒绝交付',
  not_available_for_free_order: '零元订单不可开票'
}

export default function WechatInvoicesPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(0)

  async function load() {
    setLoading(true)
    try {
      const result = await fetchWechatSyncedOrders()
      setOrders(result.filter((order) => order.invoice_requested))
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '发票记录加载失败', icon: 'none' })
    } finally { setLoading(false) }
  }

  useDidShow(() => { load() })

  async function sync(order: Order) {
    setSyncing(order.id)
    try {
      const updated = await syncWechatInvoice(order.id)
      setOrders((current) => current.map((item) => item.id === updated.id ? updated : item))
      Taro.showToast({ title: '已同步微信发票信息', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '暂未读取到微信抬头', icon: 'none' })
    } finally { setSyncing(0) }
  }

  return <View className='page wechat-invoice-page'>
    <View className='wechat-invoice-head'>
      <Text>WECHAT INVOICE</Text><Text>微信电子发票</Text>
      <Text>订单在微信确认收货后方可申请开票；抬头由微信统一保存和复用，发票开具后进入微信卡包。</Text>
    </View>
    <View className='invoice-guide'>
      <View><Text>01</Text><Text>先在微信完成确认收货</Text></View>
      <View><Text>02</Text><Text>进入订单详情申请电子发票</Text></View>
      <View><Text>03</Text><Text>开具后自动进入微信卡包</Text></View>
    </View>
    {loading ? <LuxuryLoader label='正在读取微信发票记录' /> : orders.length ? <View className='wechat-invoice-list'>
      {orders.map((order) => <View className='wechat-invoice-card' key={order.id}>
        <View className='invoice-card-top'>
          <View><Text>{order.order_no}</Text><Text>{order.created_at?.slice(0, 10) || ''}</Text></View>
          <Text>{statusText[order.invoice_status] || order.invoice_status}</Text>
        </View>
        <View className='invoice-card-main'>
          <View className='invoice-card-icon'><IconFont name='order' /></View>
          <View><Text>{order.invoice_buyer_name || '抬头将在微信中填写'}</Text><Text>{order.invoice_buyer_type === 'ORGANIZATION' ? '企业发票' : order.invoice_buyer_type === 'INDIVIDUAL' ? '个人发票' : '微信电子发票'} · {formatMoney(order.total_cents)}</Text>{order.invoice_buyer_taxpayer_id && <Text>税号 {order.invoice_buyer_taxpayer_id}</Text>}</View>
        </View>
        {order.invoice_error && <Text className='invoice-error'>{order.invoice_error}</Text>}
        <View className='invoice-card-actions'>
          <Button onClick={() => Taro.navigateTo({ url: orderDetailUrl(order.order_no) })}>查看订单</Button>
          {order.invoice_apply_id && ['apply_failed', 'pending_title', 'title_pending_sync'].includes(order.invoice_status) && <Button className='primary' loading={syncing === order.id} disabled={syncing === order.id} onClick={() => sync(order)}>同步微信抬头</Button>}
        </View>
      </View>)}
    </View> : <View className='invoice-empty'><IconFont name='order' /><Text>还没有微信发票记录</Text><Text>订单确认收货后，可在订单详情中申请微信电子发票。</Text></View>}
  </View>
}
