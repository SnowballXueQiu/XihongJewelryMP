import { useEffect, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { fetchPaymentStatus } from '@/services/api'
import IconFont from '@/components/IconFont'
import './index.scss'

export default function PaymentResultPage() {
  const router = useRouter()
  const orderId = Number(router.params.orderId || 0)
  const [result, setResult] = useState<'success' | 'pending'>(router.params.result === 'success' ? 'success' : 'pending')
  const [checking, setChecking] = useState(false)

  async function verify() {
    setChecking(true)
    try {
      const status = await fetchPaymentStatus(orderId)
      const paid = ['paid', 'preparing', 'shipped', 'completed'].includes(status.order_status)
      setResult(paid ? 'success' : 'pending')
      if (!paid) Taro.showToast({ title: status.message || '支付结果确认中', icon: 'none' })
    } catch (error) { Taro.showToast({ title: error instanceof Error ? error.message : '暂时无法查询', icon: 'none' }) }
    finally { setChecking(false) }
  }

  useEffect(() => { if (result === 'pending') verify() }, [])

  return (
    <View className={`payment-result ${result}`}>
      <View className='result-mark'><View className='result-ring'>{result === 'success' ? <IconFont name='success' /> : <View className='pending-dot' />}</View><View className='orbit orbit-one' /><View className='orbit orbit-two' /></View>
      <Text className='result-kicker'>{result === 'success' ? 'PAYMENT CONFIRMED' : 'VERIFYING PAYMENT'}</Text>
      <Text className='result-title'>{result === 'success' ? '支付完成' : '结果确认中'}</Text>
      <Text className='result-copy'>{result === 'success' ? '订单已由服务端确认到账，我们将尽快为你质检、包装并发出。' : '微信已返回，但最终结果仍需由服务端向微信支付核验。请稍后刷新，避免重复付款。'}</Text>
      <View className='result-actions'>
        {result === 'pending' && <Button className='query-action' loading={checking} disabled={checking} onClick={verify}><IconFont name='refresh' />重新查询</Button>}
        <Button className='light' onClick={() => Taro.redirectTo({ url: `/pages/order-detail/index?id=${orderId}` })}>查看订单</Button>
        <Button className='text-btn' onClick={() => Taro.switchTab({ url: '/pages/home/index' })}>返回首页</Button>
      </View>
      <Text className='security-note'>支付结果以微信支付服务端通知与主动查询为准</Text>
    </View>
  )
}
