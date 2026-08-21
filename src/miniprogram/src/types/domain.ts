export interface Category {
  id: number
  name: string
  slug: string
  sort_order: number
  is_active?: boolean
}

export interface Product {
  id: number
  name: string
  subtitle: string
  description: string
  category_slug: string
  material: string
  price_cents: number
  original_price_cents: number
  stock: number
  sales: number
  is_featured: boolean
  tags: string[]
  image_color: string
  supports_ar: boolean
  ar_model_url?: string | null
  ar_scale: string
  ar_rotation: string
  ar_position: string
  ar_auto_sync: number
  status?: 'draft' | 'active' | 'inactive'
  cover_url?: string
  gallery_urls?: string[]
  sort_order?: number
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
  signType: 'RSA'
  paySign: string
  prepayId: string
  mock: boolean
}

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'preparing'
  | 'shipped'
  | 'completed'
  | 'cancelled'
  | 'refunding'
  | 'refunded'
  | 'failed'

export interface OrderItem {
  product_id: number
  product_name: string
  unit_price_cents: number
  quantity: number
}

export interface Order {
  id: number
  order_no: string
  status: OrderStatus
  total_cents: number
  subtotal_cents: number
  shipping_fee_cents: number
  discount_cents: number
  coupon_id?: number | null
  items: OrderItem[]
  payment?: PaymentParams | null
  receiver_name: string
  receiver_phone: string
  receiver_address: string
  buyer_note: string
  logistics_company: string
  tracking_no: string
  can_pay: boolean
  can_cancel: boolean
  created_at?: string | null
  paid_at?: string | null
  shipped_at?: string | null
  completed_at?: string | null
}

export interface PaymentStatusResult {
  order_id: number
  order_status: OrderStatus
  payment_status?: 'created' | 'pending' | 'succeeded' | 'failed' | 'closed' | 'refunded' | null
  transaction_id: string
  message: string
}

export interface User {
  id: number
  nickname: string
  phone: string
  avatar_color: string
  wechat_openid?: string | null
  points: number
}

export interface Address {
  id: number
  receiver_name: string
  phone: string
  province: string
  city: string
  district: string
  detail: string
  postal_code: string
  is_default: boolean
}

export type AddressPayload = Omit<Address, 'id'>

export interface Favorite {
  id: number
  product: Product
  created_at: string
}

export interface Coupon {
  id: number
  code: string
  name: string
  description: string
  amount_cents: number
  minimum_cents: number
  valid_from: string
  valid_until?: string | null
  is_active: boolean
  claimed: boolean
  used: boolean
  available: boolean
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

export interface Banner {
  id: number
  title: string
  subtitle: string
  image_url: string
  image_color: string
  placement: string
  link_type: string
  link_value: string
  sort_order: number
  is_active: boolean
}

export interface StoreConfig {
  company_name_zh: string
  company_name_en: string
  shipping_fee_cents: number
  free_shipping_threshold_cents: number
}
