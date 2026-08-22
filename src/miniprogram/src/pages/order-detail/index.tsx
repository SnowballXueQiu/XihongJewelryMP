import { useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import {
  applyWechatInvoice,
  cancelOrder,
  canApplyWechatInvoice,
  canConfirmWechatReceipt,
  canRequestOrderRefund,
  confirmWechatOrderReceipt,
  displayOrderStatus,
  fetchWechatSyncedOrderByNumber,
  formatMoney,
  requestWechatRefund,
  syncWechatInvoice,
  syncWechatOrder
} from '@/services/api'
import { performOrderPayment, presentPaymentError } from '@/services/payment'
import { paymentResultUrl } from '@/services/routes'
import { Order } from '@/types/domain'
import IconFont from '@/components/IconFont'
import LuxuryLoader from '@/components/LuxuryLoader'
import './index.scss'

const statusCopy: Record<string, string> = {
  pending_payment: '为你保留库存，请在订单关闭前完成支付', paid: '款项已确认，店员即将开始为你备货', preparing: '作品正在仔细质检与包装', in_transit: '作品正在运输途中，物流进度由微信同步', shipped: '作品已交付物流，请留意签收', received: '微信已确认收货，可申请电子发票', completed: '感谢你的珍藏，愿它陪伴每个重要时刻', cancelled: '订单已取消，库存与优惠券已退回', refunding: '退款正在处理中', refunded: '款项已按原支付路径退回', failed: '支付状态异常，请联系客户服务'
}

const invoiceStatusText: Record<string, string> = {
  pending_title: '等待填写微信抬头', title_pending_sync: '抬头待同步', title_received: '待商家开具',
  issue_accepted: '税务开票处理中', issue_failed: '税务开票失败', insert_accepted: '正在插入微信卡包',
  card_insert_accepted: '正在插入微信卡包', inserted: '已进入微信卡包', discard_accepted: '卡券移除处理中', card_updated: '卡包状态已更新',
  discarded: '卡券已移除（不等于冲红）', issued: '电子发票已开具', reverse_accepted: '税务冲红处理中',
  reverse_failed: '税务冲红失败', partially_reversed: '部分发票已冲红，仍需处理', reversed: '电子发票已冲红', delivery_failed: '交付失败', delivery_reconciling: '交付结果核验中',
  delivery_submitted: '已提交微信卡包', delivery_rejected: '微信拒绝交付'
}

export default function OrderDetailPage() {
  const route = useRouter()
  const orderNumber = String(route.params.orderNo || '').trim()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)

  async function load() {
    try {
      if (!orderNumber) throw new Error('商户订单号缺失')
      const fetched = await fetchWechatSyncedOrderByNumber(orderNumber)
      if (fetched.invoice_requested && fetched.invoice_apply_id &&
        ['pending_title', 'title_pending_sync'].includes(fetched.invoice_status)) {
        setOrder(await syncWechatInvoice(fetched.id).catch(() => fetched))
      } else {
        setOrder(fetched)
      }
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '订单加载失败', icon: 'none' })
    } finally { setLoading(false) }
  }
  useDidShow(() => { load() })

  async function pay() {
    if (!order) return
    setActing(true)
    try {
      const result = await performOrderPayment(order.id)
      if (result.status !== 'cancelled') Taro.redirectTo({ url: paymentResultUrl(result.orderNo, result.status) })
    } catch (error) { await presentPaymentError(error, order.order_no) }
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
    try {
      const updated = await confirmWechatOrderReceipt(order)
      setOrder(updated)
      if (['received', 'completed'].includes(updated.status)) Taro.showToast({ title: '微信收货状态已同步', icon: 'success' })
      else Taro.showToast({ title: '微信状态同步中，请稍后刷新', icon: 'none' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String((error as { errMsg?: string })?.errMsg || '')
      if (!message.includes('cancel')) Taro.showToast({ title: message || '操作失败', icon: 'none' })
      void syncWechatOrder(order.order_no).catch(() => undefined)
      Taro.redirectTo({ url: '/pages/orders/index?status=shipped' })
    }
    finally { setActing(false) }
  }

  async function refund() {
    if (!order) return
    const modal = await Taro.showModal({
      title: '申请退款',
      content: '退款将按原支付路径退回，并同步进入微信退款流程。提交后请留意微信退款通知。',
      confirmText: '确认申请',
      confirmColor: '#74252D'
    })
    if (!modal.confirm) return
    setActing(true)
    try {
      setOrder(await requestWechatRefund(order.order_no))
      Taro.showToast({ title: '退款申请已提交', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '退款申请失败', icon: 'none' })
    } finally { setActing(false) }
  }

  async function applyInvoice() {
    if (!order) return
    const modal = await Taro.showModal({
      title: '申请微信电子发票',
      content: '确认后将进入微信电子发票流程，个人或企业抬头由微信统一保存并复用。',
      confirmText: '确认申请',
      confirmColor: '#74252D'
    })
    if (!modal.confirm) return
    setActing(true)
    try {
      const updated = await applyWechatInvoice(order.order_no)
      setOrder(updated)
      if (updated.invoice_miniprogram_appid && updated.invoice_miniprogram_path) {
        try {
          await Taro.navigateToMiniProgram({
            appId: updated.invoice_miniprogram_appid,
            path: updated.invoice_miniprogram_path
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String((error as { errMsg?: string })?.errMsg || '')
          if (!message.toLowerCase().includes('cancel')) {
            Taro.showToast({ title: message || '微信抬头页面打开失败', icon: 'none' })
          }
        }
      } else {
        Taro.showToast({ title: '微信抬头入口生成中，请稍后重试', icon: 'none' })
      }
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '开票申请失败', icon: 'none' })
    } finally { setActing(false) }
  }

  async function syncInvoice() {
    if (!order) return
    setActing(true)
    try {
      setOrder(await syncWechatInvoice(order.id))
      Taro.showToast({ title: '已同步微信发票信息', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '暂未读取到微信抬头', icon: 'none' })
    } finally { setActing(false) }
  }

  if (loading) return <LuxuryLoader overlay label='正在读取订单详情' />
  if (!order) return <View className='detail-missing'><Text>订单不存在</Text></View>

  return (
    <View className='order-detail-page'>
      <View className={`status-hero hero-${order.status}`}><Text>ORDER STATUS</Text><Text>{displayOrderStatus(order)}</Text><Text>{statusCopy[order.status] || '订单状态已与微信同步'}</Text><View className='status-ring' /></View>
      {order.fulfillment_type === 'delivery' && (order.tracking_no || order.platform_shipping_uploaded_at) && <View className='detail-block logistics' onClick={() => order.tracking_no && Taro.setClipboardData({ data: order.tracking_no })}>
        <View className='block-title'><Text>微信物流进度</Text><View className='copy-action'><Text>{order.tracking_no ? '复制运单号' : '微信已同步'}</Text>{order.tracking_no && <IconFont name='chevronRight' />}</View></View>
        <Text>{order.logistics_status || order.platform_order_state_label || '发货信息已同步至微信'}</Text>
        {order.tracking_no && <Text>运单号 · {order.tracking_no}</Text>}
        {order.logistics_description && <Text className='logistics-description'>{order.logistics_description}</Text>}
      </View>}
      <View className='detail-block address'><View className='block-title'><Text>{order.fulfillment_type === 'pickup' ? '自提门店' : '收货信息'}</Text><Text>{order.fulfillment_type === 'pickup' ? 'PICKUP' : 'DELIVERY'}</Text></View><Text>{order.receiver_name} · {order.receiver_phone}</Text><Text>{order.receiver_address}</Text></View>
      {order.fulfillment_type === 'pickup' && <View className='detail-block pickup-code-block'><View className='block-title'><Text>到店自提</Text><Text>凭口令提货</Text></View><Text>{order.pickup_code}</Text><Text>预约时间 · {order.pickup_slot}</Text><Text>到店后向店员出示提货口令；贵重商品请同时携带本人有效证件。</Text></View>}
      <View className='detail-block'><View className='block-title'><Text>作品清单</Text><Text>{order.items.length} 款</Text></View>
        {order.items.map((item) => <View className='detail-item' key={`${item.product_id}-${item.product_name}`} onClick={() => Taro.navigateTo({ url: `/pages/product-detail/index?id=${item.product_id}` })}><View className='item-gem'>{item.product_name.slice(0, 1)}</View><View><Text>{item.product_name}</Text><Text>{formatMoney(item.unit_price_cents)} × {item.quantity}</Text></View><Text>{formatMoney(item.unit_price_cents * item.quantity)}</Text></View>)}
      </View>
      <View className='detail-block amount-block'>
        <View><Text>商品小计</Text><Text>{formatMoney(order.subtotal_cents)}</Text></View><View><Text>配送费</Text><Text>{order.shipping_fee_cents ? formatMoney(order.shipping_fee_cents) : '包邮'}</Text></View><View><Text>优惠</Text><Text>-{formatMoney(order.discount_cents)}</Text></View><View className='grand-total'><Text>实付金额</Text><Text>{formatMoney(order.total_cents)}</Text></View>
      </View>
      {order.buyer_note && <View className='detail-block note'><Text>订单备注</Text><Text>{order.buyer_note}</Text></View>}
      {order.invoice_requested && <View className='detail-block invoice-detail'>
        <View className='block-title'><Text>微信电子发票</Text><Text>{invoiceStatusText[order.invoice_status] || '微信开票'}</Text></View>
        <Text>{order.invoice_buyer_name || '抬头请在微信电子发票页面填写'}</Text>
        {order.invoice_buyer_taxpayer_id && <Text>纳税人识别号 · {order.invoice_buyer_taxpayer_id}</Text>}
        <Text>抬头与联系方式由微信统一保存和复用，本小程序不自建发票抬头簿。</Text>
        {['pending_title', 'title_pending_sync', 'apply_failed'].includes(order.invoice_status) && <Button disabled={acting} onClick={applyInvoice}>填写或修改微信抬头</Button>}
        {order.invoice_apply_id && ['apply_failed', 'pending_title', 'title_pending_sync'].includes(order.invoice_status) && <Button disabled={acting} onClick={syncInvoice}>同步微信发票抬头</Button>}
      </View>}
      {canApplyWechatInvoice(order) && <View className='detail-block invoice-apply'>
        <View><IconFont name='order' /><View><Text>申请微信电子发票</Text><Text>确认收货后开放，抬头由微信统一保存</Text></View></View>
        <Button disabled={acting} onClick={applyInvoice}>申请开票</Button>
      </View>}
      <View className='detail-meta'><Text>订单编号 {order.order_no}</Text><Text>下单时间 {order.created_at?.replace('T', ' ').slice(0, 19)}</Text>{order.paid_at && <Text>支付时间 {order.paid_at.replace('T', ' ').slice(0, 19)}</Text>}</View>
      <View className='detail-service'><Text>需要帮助？</Text><Button openType='contact'>联系专属顾问</Button></View>
      {(order.can_pay || order.can_cancel || canRequestOrderRefund(order) || canConfirmWechatReceipt(order)) && <View className='detail-footer'>{order.can_cancel && <Button disabled={acting} onClick={cancel}>取消订单</Button>}{canRequestOrderRefund(order) && <Button className='refund' disabled={acting} onClick={refund}>申请退款</Button>}{canConfirmWechatReceipt(order) && <Button className='strong' disabled={acting} onClick={receive}>微信确认收货</Button>}{order.can_pay && <Button className='strong' loading={acting} onClick={pay}>微信支付</Button>}</View>}
    </View>
  )
}
