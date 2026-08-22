import Taro from '@tarojs/taro'
import {
  Address,
  AddressPayload,
  Banner,
  CartItem,
  Category,
  Coupon,
  Favorite,
  InvoiceTitle,
  InvoiceTitlePayload,
  Order,
  OrderStatus,
  PaymentParams,
  PaymentStatusResult,
  Pet,
  Product,
  StoreConfig,
  User
} from '@/types/domain'
import { mockCategories, mockPet, mockProducts, mockUser } from './mock'

declare const __API_BASE__: string
const API_BASE = __API_BASE__.replace(/\/$/, '')
const AUTH_KEY = 'xihong_user_token'
type RequestOptions = Omit<Taro.request.Option, 'url'> & { url?: never }

let sessionPromise: Promise<string> | null = null

function moneyToCents(value?: string): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : undefined
}

function applyProductFilters(products: Product[], filters: ProductFilters): Product[] {
  const minPrice = moneyToCents(filters.minPrice)
  const maxPrice = moneyToCents(filters.maxPrice)
  const filtered = products.filter((product) => {
    const matchCategory = !filters.category || filters.category === 'all' || product.category_slug === filters.category
    const query = filters.q?.trim().toLowerCase()
    const matchQuery = !query || [product.name, product.subtitle, product.material, ...product.tags].some((value) => value.toLowerCase().includes(query))
    const matchMaterial = !filters.material || filters.material === 'all' || product.material === filters.material
    const matchStock = !filters.inStock || product.stock > 0
    const matchFeatured = !filters.featured || product.is_featured
    const matchMinPrice = minPrice === undefined || product.price_cents >= minPrice
    const matchMaxPrice = maxPrice === undefined || product.price_cents <= maxPrice
    return matchCategory && matchQuery && matchMaterial && matchStock && matchFeatured && matchMinPrice && matchMaxPrice
  })

  if (filters.sort === 'price_asc') return [...filtered].sort((a, b) => a.price_cents - b.price_cents)
  if (filters.sort === 'price_desc') return [...filtered].sort((a, b) => b.price_cents - a.price_cents)
  if (filters.sort === 'sales') return [...filtered].sort((a, b) => b.sales - a.sales)
  return filtered
}

export async function ensureSession(): Promise<string> {
  const cached = Taro.getStorageSync<string>(AUTH_KEY)
  if (cached) return cached
  if (sessionPromise) return sessionPromise
  sessionPromise = (async () => {
    try {
      const login = await Taro.login()
      const response = await Taro.request<{ access_token: string }>({
        url: `${API_BASE}/api/auth/wechat`,
        method: 'POST',
        timeout: 6000,
        header: { 'content-type': 'application/json' },
        data: { code: login.code, nickname: '玺鸿会员' }
      })
      if (response.statusCode >= 200 && response.statusCode < 300 && response.data.access_token) {
        Taro.setStorageSync(AUTH_KEY, response.data.access_token)
        return response.data.access_token
      }
    } catch {
      // 本地后端允许匿名 mock 用户；生产环境会在具体请求中返回登录错误。
    }
    return ''
  })().finally(() => {
    sessionPromise = null
  })
  return sessionPromise
}

async function request<T>(url: string, options: RequestOptions = {}, auth = true): Promise<T> {
  const token = auth ? await ensureSession() : ''
  const response = await Taro.request<T>({
    timeout: 8000,
    header: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...options,
    url: `${API_BASE}${url}`
  })
  if (response.statusCode === 401 && token) {
    Taro.removeStorageSync(AUTH_KEY)
  }
  if (response.statusCode >= 400) {
    const data = response.data as { detail?: string } | string
    throw new Error(typeof data === 'string' ? data : data.detail || '请求失败，请稍后重试')
  }
  return response.data
}

export interface ProductFilters {
  category?: string
  q?: string
  material?: string
  inStock?: boolean
  featured?: boolean
  minPrice?: string
  maxPrice?: string
  sort?: string
}

export async function fetchCategories(): Promise<Category[]> {
  try {
    const categories = await request<Category[]>('/api/categories', {}, false)
    return [{ id: 0, name: '全部', slug: 'all', sort_order: 0 }, ...categories]
  } catch {
    return mockCategories
  }
}

export async function fetchProducts(filters: ProductFilters = {}): Promise<Product[]> {
  const params = Object.entries({
    category: filters.category,
    q: filters.q,
    material: filters.material,
    in_stock: filters.inStock ? 'true' : undefined,
    featured: filters.featured ? 'true' : undefined,
    min_price: moneyToCents(filters.minPrice),
    max_price: moneyToCents(filters.maxPrice),
    sort: filters.sort
  }).filter(([, value]) => value !== undefined && value !== '' && value !== 'all')
  const query = params.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&')
  try {
    return await request<Product[]>(`/api/products${query ? `?${query}` : ''}`, {}, false)
  } catch {
    return applyProductFilters(mockProducts, filters)
  }
}

export async function fetchProduct(id: number): Promise<Product> {
  try {
    return await request<Product>(`/api/products/${id}`, {}, false)
  } catch {
    const product = mockProducts.find((item) => item.id === id)
    if (!product) throw new Error('商品不存在')
    return product
  }
}

export async function fetchBanners(placement = 'home_hero'): Promise<Banner[]> {
  try {
    return await request<Banner[]>(`/api/banners?placement=${encodeURIComponent(placement)}`, {}, false)
  } catch {
    return []
  }
}

export async function fetchStoreConfig(): Promise<StoreConfig> {
  try {
    return await request<StoreConfig>('/api/store/config', {}, false)
  } catch {
    return { company_name_zh: '天津玺鸿珠宝贸易有限公司', company_name_en: 'Xihong Jewelry', shipping_fee_cents: 1500, free_shipping_threshold_cents: 100000, pickup_store_name: '玺鸿珠宝天津店', pickup_store_address: '天津市和平区南京路 219 号', pickup_store_phone: '16622515550' }
  }
}

export const addToCart = (productId: number, quantity = 1) => request<CartItem[]>('/api/cart', { method: 'POST', data: { product_id: productId, quantity } })
export const fetchCart = () => request<CartItem[]>('/api/cart')
export const updateCartItem = (itemId: number, quantity: number) => request<CartItem[]>(`/api/cart/${itemId}`, { method: 'PUT', data: { quantity } })
export const deleteCartItem = (itemId: number) => request<CartItem[]>(`/api/cart/${itemId}`, { method: 'DELETE' })
export const clearCart = () => request<{ ok: boolean }>('/api/cart', { method: 'DELETE' })

export const fetchAddresses = () => request<Address[]>('/api/addresses')
export const createAddress = (payload: AddressPayload) => request<Address>('/api/addresses', { method: 'POST', data: payload })
export const updateAddress = (id: number, payload: AddressPayload) => request<Address>(`/api/addresses/${id}`, { method: 'PUT', data: payload })
export const deleteAddress = (id: number) => request<{ ok: boolean }>(`/api/addresses/${id}`, { method: 'DELETE' })

export const fetchInvoiceTitles = () => request<InvoiceTitle[]>('/api/invoice-titles')
export const createInvoiceTitle = (payload: InvoiceTitlePayload) => request<InvoiceTitle>('/api/invoice-titles', { method: 'POST', data: payload })
export const updateInvoiceTitle = (id: number, payload: InvoiceTitlePayload) => request<InvoiceTitle>(`/api/invoice-titles/${id}`, { method: 'PUT', data: payload })
export const deleteInvoiceTitle = (id: number) => request<{ ok: boolean }>(`/api/invoice-titles/${id}`, { method: 'DELETE' })

export const fetchFavorites = () => request<Favorite[]>('/api/favorites')
export const toggleFavorite = (productId: number) => request<{ active: boolean }>(`/api/favorites/${productId}`, { method: 'PUT' })

export const fetchCoupons = () => request<Coupon[]>('/api/coupons')
export const claimCoupon = (couponId: number) => request<Coupon>(`/api/coupons/${couponId}/claim`, { method: 'POST' })

export const createOrder = (payload: {
  items: Array<{ product_id: number; quantity: number }>
  address_id?: number | null
  coupon_id?: number | null
  buyer_note?: string
  fulfillment_type?: 'delivery' | 'pickup'
  pickup_slot?: string
  invoice_type?: 'none' | 'personal' | 'company'
  invoice_title?: string
  invoice_tax_number?: string
  invoice_email?: string
  client_request_id?: string
}) => request<Order>('/api/orders', { method: 'POST', data: payload })

export const startOrderPayment = (orderId: number) => request<PaymentParams>(`/api/orders/${orderId}/pay`, { method: 'POST' })
export const fetchPaymentStatus = (orderId: number) => request<PaymentStatusResult>(`/api/orders/${orderId}/payment-status`)
export const confirmMockPayment = (orderId: number) => request<Order>(`/api/orders/${orderId}/mock-pay`, { method: 'POST' })
export const fetchOrders = (status?: OrderStatus) => request<Order[]>(`/api/orders${status ? `?status=${status}` : ''}`)
export const fetchOrder = (orderId: number) => request<Order>(`/api/orders/${orderId}`)
export const cancelOrder = (orderId: number) => request<Order>(`/api/orders/${orderId}/cancel`, { method: 'POST' })
export const completeOrder = (orderId: number) => request<Order>(`/api/orders/${orderId}/complete`, { method: 'POST' })

export async function fetchUser(): Promise<User> {
  try {
    return await request<User>('/api/me')
  } catch {
    return mockUser
  }
}

export const bindWechatPhone = (code: string) => request<User>('/api/me/phone', { method: 'POST', data: { code } })

export async function fetchPet(): Promise<Pet> {
  try {
    return await request<Pet>('/api/pet')
  } catch {
    return mockPet
  }
}

export async function petAction(action: 'feed' | 'pet' | 'checkin' | 'order_reward'): Promise<Pet> {
  return request<Pet>('/api/pet/action', { method: 'POST', data: { action } })
}

export function formatMoney(cents: number): string {
  const value = cents / 100
  return `¥${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)}`
}

export const orderStatusLabel: Record<OrderStatus, string> = {
  pending_payment: '待支付',
  paid: '已支付',
  preparing: '备货中',
  shipped: '已发货',
  completed: '已完成',
  cancelled: '已取消',
  refunding: '退款中',
  refunded: '已退款',
  failed: '支付异常'
}
