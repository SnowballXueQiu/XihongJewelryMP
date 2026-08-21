import { useMemo, useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { Button, Input, Picker, Text, View } from '@tarojs/components'
import JewelryVisual from '@/components/JewelryVisual'
import IconFont from '@/components/IconFont'
import {
  createOrder,
  fetchAddresses,
  fetchCoupons,
  fetchProduct,
  fetchStoreConfig,
  formatMoney
} from '@/services/api'
import { performOrderPayment, presentPaymentError } from '@/services/payment'
import { usePageEntranceAnimation } from '@/hooks/useSubtleAnimation'
import { Address, Coupon, Product, StoreConfig } from '@/types/domain'
import './index.scss'

interface CheckoutLine { product_id: number; quantity: number; product?: Product }

export default function OrderConfirmPage() {
  const router = useRouter()
  const [lines, setLines] = useState<CheckoutLine[]>([])
  const [addresses, setAddresses] = useState<Address[]>([])
  const [addressId, setAddressId] = useState<number | null>(null)
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [couponIndex, setCouponIndex] = useState(0)
  const [buyerNote, setBuyerNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [storeConfig, setStoreConfig] = useState<StoreConfig>({ company_name_zh: '', company_name_en: '', shipping_fee_cents: 1500, free_shipping_threshold_cents: 100000 })
  const pageAnimation = usePageEntranceAnimation()

  const rawItems = useMemo(() => {
    try {
      return JSON.parse(decodeURIComponent(String(router.params.items || '[]'))) as Array<{ product_id: number; quantity: number }>
    } catch {
      return []
    }
  }, [router.params.items])

  useDidShow(() => {
    Promise.all([
      Promise.all(rawItems.map(async (item) => ({ ...item, product: await fetchProduct(item.product_id) }))),
      fetchAddresses(),
      fetchCoupons(),
      fetchStoreConfig()
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
  const shipping = allItemsFreeShipping || subtotal >= storeConfig.free_shipping_threshold_cents ? 0 : storeConfig.shipping_fee_cents
  const eligibleCoupons = useMemo(() => [null, ...coupons.filter((item) => subtotal >= item.minimum_cents)] as Array<Coupon | null>, [coupons, subtotal])
  const selectedCoupon = eligibleCoupons[couponIndex] || null
  const discount = selectedCoupon ? Math.min(selectedCoupon.amount_cents, subtotal) : 0
  const total = Math.max(1, subtotal + shipping - discount)
  const couponLabels = eligibleCoupons.map((item) => item ? `${item.name}  -${formatMoney(item.amount_cents)}` : '暂不使用优惠券')

  async function submitOrder() {
    if (submitting) return
    if (!lines.length || !addressId) {
      Taro.showToast({ title: addressId ? '没有可结算商品' : '请先添加收货地址', icon: 'none' })
      return
    }
    setSubmitting(true)
    let createdOrderId = 0
    try {
      const order = await createOrder({
        items: lines.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
        address_id: addressId,
        coupon_id: selectedCoupon?.id || null,
        buyer_note: buyerNote.trim()
      })
      createdOrderId = order.id
      const result = await performOrderPayment(order.id)
      if (result === 'cancelled') Taro.redirectTo({ url: `/pages/order-detail/index?id=${order.id}` })
      else Taro.redirectTo({ url: `/pages/payment-result/index?orderId=${order.id}&result=${result}` })
    } catch (error) {
      if (createdOrderId) await presentPaymentError(error, createdOrderId)
      else Taro.showToast({ title: error instanceof Error ? error.message : '订单提交失败', icon: 'none', duration: 2600 })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View className='page order-page' animation={pageAnimation}>
      <View className='checkout-head'><Text className='checkout-kicker'>CHECKOUT</Text><Text className='checkout-title'>确认订单</Text></View>

      <Button className='address-card' hoverClass='card-press' onClick={() => Taro.navigateTo({ url: '/pages/addresses/index?select=1' })}>
        <View className='block-heading'><Text>01</Text><Text>配送地址</Text><View className='heading-action'><Text>更换</Text><IconFont name='chevronRight' /></View></View>
        {address ? (
          <View className='address-content'>
            <Text className='address-person'>{address.receiver_name} · {address.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}</Text>
            <Text className='address-line'>{address.province} {address.city} {address.district} {address.detail}</Text>
            {address.is_default && <Text className='default-badge'>默认地址</Text>}
          </View>
        ) : <View className='address-empty'><IconFont name='plus' /><Text>添加收货地址</Text></View>}
      </Button>

      <View className='checkout-block'>
        <View className='block-heading'><Text>02</Text><Text>订单商品</Text><Text>{lines.reduce((sum, item) => sum + item.quantity, 0)} 件</Text></View>
        {loading ? <View className='checkout-loading' /> : lines.map((item) => item.product && (
          <View key={item.product_id} className='checkout-line'>
            <View className='line-visual'><JewelryVisual product={item.product} compact={false} showLabel={false} /></View>
            <View className='line-copy'>
              <Text className='line-material'>{item.product.material}</Text>
              <Text className='line-name'>{item.product.name}</Text>
              <Text className='line-sub'>{item.product.subtitle}</Text>
              {item.product.free_shipping && <Text className='line-shipping'>此商品包邮</Text>}
              <View className='line-price'><Text>{formatMoney(item.product.price_cents)}</Text><Text>× {item.quantity}</Text></View>
            </View>
          </View>
        ))}
      </View>

      <View className='checkout-block options-block'>
        <View className='block-heading'><Text>03</Text><Text>优惠与备注</Text><Text /></View>
        <Picker mode='selector' range={couponLabels} value={couponIndex} onChange={(event) => setCouponIndex(Number(event.detail.value))}>
          <View className='option-row'><Text>优惠券</Text><View className={selectedCoupon ? 'option-value accent' : 'option-value'}><Text>{couponLabels[couponIndex] || '暂无可用'}</Text><IconFont name='chevronRight' /></View></View>
        </Picker>
        <View className='note-row'><Text>订单备注</Text><Input value={buyerNote} maxlength={200} placeholder='选填，给店员留言' onInput={(event) => setBuyerNote(String(event.detail.value))} /></View>
      </View>

      <View className='price-summary'>
        <View><Text>商品小计</Text><Text>{formatMoney(subtotal)}</Text></View>
        <View><Text>顺丰保价配送</Text><Text>{shipping ? formatMoney(shipping) : '包邮'}</Text></View>
        <View><Text>优惠</Text><Text className='discount'>{discount ? `-${formatMoney(discount)}` : '¥0'}</Text></View>
        <View className='summary-total'><Text>应付合计</Text><Text>{formatMoney(total)}</Text></View>
      </View>

      <View className='payment-assurance'><Text>微信支付</Text><Text>支付信息由微信安全加密处理</Text></View>
      <View className='checkout-footer'>
        <View><Text>应付</Text><Text>{formatMoney(total)}</Text></View>
        <Button loading={submitting} disabled={submitting || !addressId || !lines.length} hoverClass='button-press' onClick={submitOrder}>微信支付</Button>
      </View>
    </View>
  )
}
