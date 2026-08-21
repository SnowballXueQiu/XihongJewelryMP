import Taro from '@tarojs/taro'
import { confirmMockPayment, fetchPaymentStatus, startOrderPayment } from './api'

export type PaymentFlowResult = 'success' | 'pending' | 'cancelled'

export async function performOrderPayment(orderId: number): Promise<PaymentFlowResult> {
  const payment = await startOrderPayment(orderId)
  if (payment.mock) {
    const modal = await Taro.showModal({
      title: '开发环境模拟支付',
      content: '当前后端启用了明确的支付模拟开关。该操作仅用于联调订单和履约流程，不代表真实微信支付。',
      confirmText: '模拟成功',
      cancelText: '稍后支付',
      confirmColor: '#74252D'
    })
    if (!modal.confirm) return 'cancelled'
    await confirmMockPayment(orderId)
    return 'success'
  }

  try {
    await Taro.requestPayment({
      timeStamp: payment.timeStamp,
      nonceStr: payment.nonceStr,
      package: payment.package,
      signType: 'RSA',
      paySign: payment.paySign
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.toLowerCase().includes('cancel')) return 'cancelled'
  }

  const status = await fetchPaymentStatus(orderId).catch(() => null)
  return status?.order_status === 'paid' || status?.order_status === 'preparing' || status?.order_status === 'shipped' || status?.order_status === 'completed'
    ? 'success'
    : 'pending'
}
