import Taro from '@tarojs/taro'
import { CartItem, Category, Order, Pet, Product, User } from '@/types/domain'
import { mockCategories, mockPet, mockProducts, mockUser } from './mock'

const API_BASE = 'http://127.0.0.1:8000'
type RequestOptions = Omit<Taro.request.Option, 'url'> & { url?: never }

function moneyToCents(value?: string): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : undefined
}

function applyProductFilters(products: Product[], filters: {
  category?: string
  q?: string
  material?: string
  arOnly?: boolean
  minPrice?: string
  maxPrice?: string
  sort?: string
}): Product[] {
  const minPrice = moneyToCents(filters.minPrice)
  const maxPrice = moneyToCents(filters.maxPrice)
  const filtered = products.filter((product) => {
    const matchCategory = !filters.category || filters.category === 'all' || product.category_slug === filters.category
    const matchQuery = !filters.q || product.name.includes(filters.q) || product.subtitle.includes(filters.q) || product.material.includes(filters.q)
    const matchMaterial = !filters.material || filters.material === 'all' || product.material === filters.material
    const matchAr = !filters.arOnly || product.supports_ar
    const matchMinPrice = minPrice === undefined || product.price_cents >= minPrice
    const matchMaxPrice = maxPrice === undefined || product.price_cents <= maxPrice
    return matchCategory && matchQuery && matchMaterial && matchAr && matchMinPrice && matchMaxPrice
  })

  if (filters.sort === 'price_asc') {
    return [...filtered].sort((a, b) => a.price_cents - b.price_cents)
  }
  if (filters.sort === 'price_desc') {
    return [...filtered].sort((a, b) => b.price_cents - a.price_cents)
  }
  return filtered
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await Taro.request<T>({
    timeout: 5000,
    header: { 'content-type': 'application/json' },
    ...options,
    url: `${API_BASE}${url}`
  })
  if (response.statusCode >= 400) {
    throw new Error(typeof response.data === 'string' ? response.data : '请求失败')
  }
  return response.data
}

export async function fetchCategories(): Promise<Category[]> {
  try {
    const categories = await request<Category[]>('/api/categories')
    return [{ id: 0, name: '全部', slug: 'all', sort_order: 0 }, ...categories]
  } catch {
    return mockCategories
  }
}

export async function fetchProducts(filters: {
  category?: string
  q?: string
  material?: string
  arOnly?: boolean
  minPrice?: string
  maxPrice?: string
  sort?: string
} = {}): Promise<Product[]> {
  const params = Object.entries({
    category: filters.category,
    q: filters.q,
    material: filters.material,
    ar_only: filters.arOnly ? 'true' : undefined,
    min_price: moneyToCents(filters.minPrice),
    max_price: moneyToCents(filters.maxPrice),
    sort: filters.sort
  }).filter(([, value]) => value !== undefined && value !== '' && value !== 'all')
  const query = params.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&')
  try {
    return await request<Product[]>(`/api/products${query ? `?${query}` : ''}`)
  } catch {
    return applyProductFilters(mockProducts, filters)
  }
}

export async function fetchProduct(id: number): Promise<Product> {
  try {
    return await request<Product>(`/api/products/${id}`)
  } catch {
    const product = mockProducts.find((item) => item.id === id)
    if (!product) throw new Error('商品不存在')
    return product
  }
}

export async function addToCart(productId: number, quantity = 1): Promise<CartItem[]> {
  try {
    return await request<CartItem[]>('/api/cart', {
      method: 'POST',
      data: { product_id: productId, quantity }
    })
  } catch {
    const product = mockProducts.find((item) => item.id === productId) || mockProducts[0]
    return [{ id: productId, product, quantity, subtotal_cents: product.price_cents * quantity }]
  }
}

export async function fetchCart(): Promise<CartItem[]> {
  try {
    return await request<CartItem[]>('/api/cart')
  } catch {
    return []
  }
}

export async function createOrder(items: Array<{ product_id: number; quantity: number }>): Promise<Order> {
  try {
    return await request<Order>('/api/orders', {
      method: 'POST',
      data: { items }
    })
  } catch {
    const orderItems = items.map((item) => {
      const product = mockProducts.find((entry) => entry.id === item.product_id) || mockProducts[0]
      return {
        product_id: product.id,
        product_name: product.name,
        unit_price_cents: product.price_cents,
        quantity: item.quantity
      }
    })
    return {
      id: Date.now(),
      status: 'pending_payment',
      total_cents: orderItems.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0),
      items: orderItems,
      payment: {
        provider: 'wechat_pay',
        appId: 'wx_mock_appid',
        timeStamp: String(Math.floor(Date.now() / 1000)),
        nonceStr: 'mock_nonce',
        package: 'prepay_id=mock',
        signType: 'RSA',
        paySign: 'MOCK_SIGN',
        prepayId: 'mock',
        mock: true
      }
    }
  }
}

export async function fetchUser(): Promise<User> {
  try {
    return await request<User>('/api/me')
  } catch {
    return mockUser
  }
}

export async function fetchPet(): Promise<Pet> {
  try {
    return await request<Pet>('/api/pet')
  } catch {
    return mockPet
  }
}

export async function petAction(action: 'feed' | 'pet' | 'checkin' | 'order_reward'): Promise<Pet> {
  try {
    return await request<Pet>('/api/pet/action', {
      method: 'POST',
      data: { action }
    })
  } catch {
    return {
      ...mockPet,
      exp: mockPet.exp + 8,
      mood: Math.min(100, mockPet.mood + 8),
      hunger: Math.max(0, mockPet.hunger - 8)
    }
  }
}

export function formatMoney(cents: number): string {
  return `¥${(cents / 100).toFixed(0)}`
}
