export interface Category {
  id: number
  name: string
  slug: string
  sort_order: number
}

export interface Product {
  id: number
  name: string
  subtitle: string
  description: string
  category_slug: string
  material: string
  price_cents: number
  stock: number
  image_color: string
  supports_ar: boolean
  ar_model_url?: string | null
  ar_scale: string
  ar_rotation: string
  ar_position: string
  ar_auto_sync: number
}

export interface CartItem {
  id: number
  product: Product
  quantity: number
  subtotal_cents: number
}

export interface PaymentParams {
  provider: string
  appId: string
  timeStamp: string
  nonceStr: string
  package: string
  signType: string
  paySign: string
  prepayId: string
  mock: boolean
}

export interface Order {
  id: number
  status: 'pending_payment' | 'paid' | 'cancelled' | 'failed'
  total_cents: number
  items: Array<{
    product_id: number
    product_name: string
    unit_price_cents: number
    quantity: number
  }>
  payment?: PaymentParams | null
}

export interface User {
  id: number
  nickname: string
  phone: string
  avatar_color: string
  wechat_openid?: string | null
  points: number
}

export interface Pet {
  name: string
  level: number
  exp: number
  mood: number
  hunger: number
  next_level_exp: number
  reward: string
  asset_key: string
}
