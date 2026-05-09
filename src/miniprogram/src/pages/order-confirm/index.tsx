import { useMemo, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { createOrder, formatMoney } from '@/services/api'
import { Order } from '@/types/domain'
import './index.scss'

export default function OrderConfirmPage() {
  const router = useRouter()
  const [order, setOrder] = useState<Order | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const items = useMemo(() => {
    try {
      return JSON.parse(decodeURIComponent(String(router.params.items || '[]'))) as Array<{ product_id: number; quantity: number }>
    } catch {
      return []
    }
  }, [router.params.items])

  async function submitOrder() {
    if (!items.length) {
      Taro.showToast({ title: '没有可结算商品', icon: 'none' })
      return
    }
    setSubmitting(true)
    const created = await createOrder(items)
    setOrder(created)
    setSubmitting(false)
    if (created.payment?.mock) {
      Taro.showModal({
        title: '支付骨架已生成',
        content: `订单 ${created.id} 已创建。接入真实微信支付后，这里会调用 requestPayment。`,
        showCancel: false
      })
      return
    }
    if (created.payment) {
      await Taro.requestPayment({
        timeStamp: created.payment.timeStamp,
        nonceStr: created.payment.nonceStr,
        package: created.payment.package,
        signType: created.payment.signType as 'RSA',
        paySign: created.payment.paySign
      })
    }
  }

  return (
    <View className='page order-page'>
      <View className='address card'>
        <Text className='block-title'>收货信息</Text>
        <Text className='address-line'>测试用户 13800000000</Text>
        <Text className='address-line'>天津市玺鸿珠宝体验店</Text>
      </View>

      <View className='summary card'>
        <Text className='block-title'>订单商品</Text>
        {items.map((item) => (
          <View key={item.product_id} className='summary-row'>
            <Text>商品 #{item.product_id}</Text>
            <Text>x {item.quantity}</Text>
          </View>
        ))}
      </View>

      {order && (
        <View className='payment card'>
          <Text className='block-title'>支付预留</Text>
          <Text className='payment-line'>订单号：{order.id}</Text>
          <Text className='payment-line'>状态：{order.status}</Text>
          <Text className='payment-line'>金额：{formatMoney(order.total_cents)}</Text>
          <Text className='payment-line'>prepay_id：{order.payment?.prepayId}</Text>
        </View>
      )}

      <Button className='primary-btn submit' loading={submitting} onClick={submitOrder}>
        创建订单并预支付
      </Button>
    </View>
  )
}
