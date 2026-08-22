import { useMemo, useRef, useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { Button, Input, Picker, Text, View } from '@tarojs/components'
import JewelryVisual from '@/components/JewelryVisual'
import IconFont from '@/components/IconFont'
import LuxuryLoader from '@/components/LuxuryLoader'
import { createAddress, createOrder, fetchAddresses, fetchCoupons, fetchOrder, fetchProduct, fetchStoreConfig, formatMoney } from '@/services/api'
import { performOrderPayment, presentPaymentError } from '@/services/payment'
import { paymentResultUrl } from '@/services/routes'
import { usePageEntranceAnimation } from '@/hooks/useSubtleAnimation'
import { Address, Coupon, Product, StoreConfig } from '@/types/domain'
import './index.scss'

interface CheckoutLine { product_id: number; quantity: number; product?: Product }
type FulfillmentType = 'delivery' | 'pickup'

function buildPickupSlots() {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const periods = ['10:00–12:00', '14:00–16:00', '17:00–19:00']
  return Array.from({ length: 7 }).flatMap((_, dayOffset) => {
    const date = new Date()
    date.setDate(date.getDate() + dayOffset)
    const day = `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`
    return periods.map((period) => `${day} ${period}`)
  })
}

const defaultStore: StoreConfig = {
  company_name_zh: '', company_name_en: '', shipping_fee_cents: 1500, free_shipping_threshold_cents: 100000,
  pickup_store_name: '玺鸿珠宝天津店', pickup_store_address: '天津市和平区南京路 219 号', pickup_store_phone: '16622515550'
}

export default function OrderConfirmPage() {
  const router = useRouter()
  const [lines, setLines] = useState<CheckoutLine[]>([])
  const [addresses, setAddresses] = useState<Address[]>([])
  const [addressId, setAddressId] = useState<number | null>(null)
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>('delivery')
  const [pickupIndex, setPickupIndex] = useState(0)
  const [invoiceRequested, setInvoiceRequested] = useState(false)
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [couponIndex, setCouponIndex] = useState(0)
  const [buyerNote, setBuyerNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [storeConfig, setStoreConfig] = useState<StoreConfig>(defaultStore)
  const pickupSlots = useMemo(buildPickupSlots, [])
  const pageAnimation = usePageEntranceAnimation()
  const clientRequestId = useRef(`checkout_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`).current
  const createdOrderId = useRef(0)
  const createdOrderNo = useRef('')

  const rawItems = useMemo(() => {
    try { return JSON.parse(decodeURIComponent(String(router.params.items || '[]'))) as Array<{ product_id: number; quantity: number }> }
    catch { return [] }
  }, [router.params.items])

  useDidShow(() => {
    Promise.all([
      Promise.all(rawItems.map(async (item) => ({ ...item, product: await fetchProduct(item.product_id) }))),
      fetchAddresses(), fetchCoupons(), fetchStoreConfig()
    ]).then(([nextLines, nextAddresses, nextCoupons, nextStoreConfig]) => {
      const selectedAddressId = Number(Taro.getStorageSync('selected_address_id') || 0)
      Taro.removeStorageSync('selected_address_id')
      setLines(nextLines)
      setAddresses(nextAddresses)
      setAddressId((current) => selectedAddressId || current || nextAddresses.find((item) => item.is_default)?.id || nextAddresses[0]?.id || null)
      setCoupons(nextCoupons.filter((item) => item.claimed && item.available))
      setStoreConfig(nextStoreConfig)
    }).catch((error) => Taro.showToast({ title: error instanceof Error ? error.message : '结算信息加载失败', icon: 'none' }))
      .finally(() => setLoading(false))
  })

  const address = addresses.find((item) => item.id === addressId)
  const subtotal = lines.reduce((sum, item) => sum + (item.product?.price_cents || 0) * item.quantity, 0)
  const allItemsFreeShipping = lines.length > 0 && lines.every((item) => item.product?.free_shipping)
  const shipping = fulfillmentType === 'pickup' || allItemsFreeShipping || subtotal >= storeConfig.free_shipping_threshold_cents ? 0 : storeConfig.shipping_fee_cents
  const eligibleCoupons = useMemo(() => [null, ...coupons.filter((item) => subtotal >= item.minimum_cents)] as Array<Coupon | null>, [coupons, subtotal])
  const selectedCoupon = eligibleCoupons[couponIndex] || null
  const discount = selectedCoupon ? Math.min(selectedCoupon.amount_cents, subtotal) : 0
  const total = Math.max(0, subtotal + shipping - discount)
  const couponLabels = eligibleCoupons.map((item) => item ? `${item.name}  -${formatMoney(item.amount_cents)}` : '暂不使用优惠券')

  async function importWechatAddress() {
    try {
      const result = await Taro.chooseAddress()
      if (!/^1\d{10}$/.test(result.telNumber)) throw new Error('微信地址中的手机号格式暂不支持，请在地址簿中修改')
      const saved = await createAddress({
        receiver_name: result.userName, phone: result.telNumber, province: result.provinceName, city: result.cityName,
        district: result.countyName, detail: [result.streetName, result.detailInfoNew || result.detailInfo].filter(Boolean).join(' '),
        postal_code: result.postalCode || '', is_default: addresses.length === 0
      })
      setAddresses((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
      setAddressId(saved.id)
      Taro.showToast({ title: '微信地址已导入', icon: 'success' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String((error as { errMsg?: string })?.errMsg || '')
      if (!message.includes('cancel')) Taro.showToast({ title: message || '无法读取微信地址', icon: 'none' })
    }
  }

  async function submitOrder() {
    if (submitting) return
    if (!lines.length) return Taro.showToast({ title: '没有可结算商品', icon: 'none' })
    if (fulfillmentType === 'delivery' && !addressId) return Taro.showToast({ title: '请先添加收货地址', icon: 'none' })
    setSubmitting(true)
    try {
      const payload = {
        items: lines.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
        address_id: fulfillmentType === 'delivery' ? addressId : null, coupon_id: selectedCoupon?.id || null, buyer_note: buyerNote.trim(),
        fulfillment_type: fulfillmentType, pickup_slot: fulfillmentType === 'pickup' ? pickupSlots[pickupIndex] : '',
        invoice_requested: total > 0 && invoiceRequested,
        client_request_id: clientRequestId
      } as const
      const order = createdOrderId.current ? await fetchOrder(createdOrderId.current) : await createOrder(payload)
      createdOrderId.current = order.id
      createdOrderNo.current = order.order_no
      if (order.status !== 'pending_payment') {
        Taro.redirectTo({ url: paymentResultUrl(order.order_no, 'success') })
        return
      }
      const result = await performOrderPayment(order.id)
      if (result.status === 'cancelled') Taro.redirectTo({ url: '/pages/orders/index?status=pending_payment' })
      else Taro.redirectTo({ url: paymentResultUrl(result.orderNo, result.status) })
    } catch (error) {
      if (createdOrderNo.current) await presentPaymentError(error, createdOrderNo.current)
      else await Taro.showModal({ title: '订单未完成', content: error instanceof Error ? error.message : '订单提交状态未知，请到订单中心查看。', showCancel: false, confirmText: '查看订单', confirmColor: '#74252D' })
      await Taro.redirectTo({ url: `/pages/orders/index?status=${createdOrderId.current ? 'pending_payment' : 'all'}` })
    } finally { setSubmitting(false) }
  }

  const submitDisabled = submitting || !lines.length || (fulfillmentType === 'delivery' && !addressId)

  return <View className='page order-page' animation={pageAnimation}>
    <View className='checkout-head'><Text className='checkout-kicker'>CHECKOUT</Text><Text className='checkout-title'>确认订单</Text></View>

    <View className='checkout-block method-block'>
      <View className='block-heading'><Text>01</Text><Text>收货方式</Text><Text>请选择</Text></View>
      <View className='method-switch'>
        <Button className={fulfillmentType === 'delivery' ? 'active' : ''} onClick={() => setFulfillmentType('delivery')}><IconFont name='shipping' /><Text>快递配送</Text><Text>顺丰保价送达</Text></Button>
        <Button className={fulfillmentType === 'pickup' ? 'active' : ''} onClick={() => setFulfillmentType('pickup')}><IconFont name='location' /><Text>到店自提</Text><Text>免配送费</Text></Button>
      </View>
      {fulfillmentType === 'delivery' ? <View className='fulfillment-panel'>
        <View className='address-row' onClick={() => Taro.navigateTo({ url: '/pages/addresses/index?select=1' })}>
          <IconFont name='location' />
          {address ? <View><Text>{address.receiver_name} · {address.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}</Text><Text>{address.province} {address.city} {address.district} {address.detail}</Text></View> : <View><Text>添加收货地址</Text><Text>填写联系人与详细地址</Text></View>}
          <IconFont name='chevronRight' />
        </View>
        <Button className='wechat-import' onClick={importWechatAddress}><IconFont name='plus' />从微信地址选择</Button>
      </View> : <View className='pickup-panel'>
        <View className='store-card'><IconFont name='location' /><View><Text>{storeConfig.pickup_store_name}</Text><Text>{storeConfig.pickup_store_address}</Text><Text>{storeConfig.pickup_store_phone}</Text></View></View>
        <Picker mode='selector' range={pickupSlots} value={pickupIndex} onChange={(event) => setPickupIndex(Number(event.detail.value))}>
          <View className='slot-row'><Text>预约到店时间</Text><View><Text>{pickupSlots[pickupIndex]}</Text><IconFont name='chevronRight' /></View></View>
        </Picker>
        <Text className='pickup-tip'>支付完成后生成“数字序号 + 提货短语”，到店向店员出示即可。</Text>
      </View>}
    </View>

    <View className='checkout-block'>
      <View className='block-heading'><Text>02</Text><Text>订单商品</Text><Text>{lines.reduce((sum, item) => sum + item.quantity, 0)} 件</Text></View>
      {loading ? <LuxuryLoader label='正在核对订单信息' /> : lines.map((item) => item.product && <View key={item.product_id} className='checkout-line'>
        <View className='line-visual'><JewelryVisual product={item.product} compact={false} showLabel={false} /></View>
        <View className='line-copy'><Text className='line-material'>{item.product.material}</Text><Text className='line-name'>{item.product.name}</Text><Text className='line-sub'>{item.product.subtitle}</Text>{item.product.free_shipping && <Text className='line-shipping'>此商品包邮</Text>}<View className='line-price'><Text>{formatMoney(item.product.price_cents)}</Text><Text>× {item.quantity}</Text></View></View>
      </View>)}
    </View>

    <View className='checkout-block options-block'>
      <View className='block-heading'><Text>03</Text><Text>发票与优惠</Text><Text /></View>
      <Button
        className={invoiceRequested && total > 0 ? 'wechat-invoice-row active' : 'wechat-invoice-row'}
        disabled={total === 0}
        onClick={() => setInvoiceRequested((current) => !current)}
      >
        <View className='wechat-invoice-check' />
        <View><Text>微信电子发票</Text><Text>{total === 0 ? '零元订单不支持开票' : '支付后在微信支付凭证中填写个人或企业抬头'}</Text></View>
        <Text>{invoiceRequested && total > 0 ? '已选择' : '暂不需要'}</Text>
      </Button>
      <Picker mode='selector' range={couponLabels} value={couponIndex} onChange={(event) => setCouponIndex(Number(event.detail.value))}><View className='option-row'><Text>优惠券</Text><View className={selectedCoupon ? 'option-value accent' : 'option-value'}><Text>{couponLabels[couponIndex] || '暂无可用'}</Text><IconFont name='chevronRight' /></View></View></Picker>
      <View className='note-row'><Text>订单备注</Text><Input value={buyerNote} maxlength={200} placeholder='选填，给店员留言' onInput={(event) => setBuyerNote(String(event.detail.value))} /></View>
    </View>

    <View className='price-summary'><View><Text>商品小计</Text><Text>{formatMoney(subtotal)}</Text></View><View><Text>{fulfillmentType === 'pickup' ? '到店自提' : '顺丰保价配送'}</Text><Text>{shipping ? formatMoney(shipping) : fulfillmentType === 'pickup' ? '免配送费' : '包邮'}</Text></View><View><Text>优惠</Text><Text className='discount'>{discount ? `-${formatMoney(discount)}` : '¥0'}</Text></View><View className='summary-total'><Text>应付合计</Text><Text>{formatMoney(total)}</Text></View></View>
    <View className='payment-assurance'><IconFont name='wallet' /><View><Text>{total === 0 ? '免支付订单' : '微信支付'}</Text><Text>{total === 0 ? '零元测试订单不会唤起微信收银台或产生扣款' : '支付信息由微信安全加密处理'}</Text></View></View>
    <View className='checkout-footer'><View><Text>应付</Text><Text>{formatMoney(total)}</Text></View><Button loading={submitting} disabled={submitDisabled} hoverClass='button-press' onClick={submitOrder}>{total === 0 ? '确认免支付订单' : createdOrderId.current ? '继续支付' : '微信支付'}</Button></View>
  </View>
}
