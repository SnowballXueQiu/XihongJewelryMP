import Taro from '@tarojs/taro'
import { confirmMockPayment, fetchPaymentStatus, startOrderPayment } from './api'

export type PaymentFlowResult = 'success' | 'pending' | 'cancelled'
export type PaymentErrorCode = 'capability_restricted' | 'request_failed'

export class PaymentFlowError extends Error {
  code: PaymentErrorCode

  constructor(code: PaymentErrorCode, message: string) {
    super(message)
    this.name = 'PaymentFlowError'
    this.code = code
  }
}

function paymentErrorText(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'errMsg' in error) {
    return String((error as { errMsg?: unknown }).errMsg || '')
  }
  return error instanceof Error ? error.message : String(error || '')
}

function paymentSucceeded(status: { order_status?: string } | null): boolean {
  return Boolean(status && ['paid', 'preparing', 'shipped', 'completed'].includes(String(status.order_status)))
}

export async function presentPaymentError(error: unknown, orderId?: number): Promise<void> {
  const restricted = error instanceof PaymentFlowError && error.code === 'capability_restricted'
  if (restricted) {
    const modal = await Taro.showModal({
      title: '当前无法使用微信支付',
      content: error.message,
      confirmText: orderId ? '查看订单' : '我知道了',
      cancelText: orderId ? '稍后处理' : undefined,
      showCancel: Boolean(orderId),
      confirmColor: '#74252D'
    })
    if (orderId && modal.confirm) {
      await Taro.redirectTo({ url: `/pages/order-detail/index?id=${orderId}` })
    }
    return
  }
  await Taro.showModal({
    title: '支付未完成',
    content: error instanceof Error ? error.message : '支付发起失败，订单已保留，请稍后重试。',
    showCancel: false,
    confirmText: '查看订单',
    confirmColor: '#74252D'
  })
}

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
    const message = paymentErrorText(error)
    if (/cancel/i.test(message)) return 'cancelled'

    const status = await fetchPaymentStatus(orderId).catch(() => null)
    if (paymentSucceeded(status)) return 'success'

    if (/violated platform rules|unable to use pay|payment.*restricted|支付.{0,8}(受限|违规|停用)/i.test(message)) {
      throw new PaymentFlowError(
        'capability_restricted',
        '微信平台暂时限制当前小程序的支付能力。订单已保留且不会重复创建，请到“我的订单”稍后重试；管理员需在公众平台核对支付能力、订单发货管理与风控状态。'
      )
    }
    throw new PaymentFlowError('request_failed', '微信支付未能完成，订单已保留，请稍后在订单中心重试。')
  }

  const status = await fetchPaymentStatus(orderId).catch(() => null)
  return paymentSucceeded(status) ? 'success' : 'pending'
}
