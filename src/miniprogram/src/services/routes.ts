export function orderDetailUrl(orderNo: string): string {
  return `/pages/order-detail/index?orderNo=${encodeURIComponent(orderNo)}`
}

export function paymentResultUrl(orderNo: string, result: 'success' | 'pending'): string {
  return `/pages/payment-result/index?orderNo=${encodeURIComponent(orderNo)}&result=${result}`
}
