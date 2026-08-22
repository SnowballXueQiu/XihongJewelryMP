'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000'

type AdminUser = {
  id: number
  email: string
  name: string
  role: 'super_admin' | 'admin'
  is_active: boolean
  created_at?: string | null
  last_login_at?: string | null
}

type Category = {
  id: number
  name: string
  slug: string
  sort_order: number
  is_active: boolean
}

type Product = {
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
  free_shipping: boolean
  tags: string[]
  image_color: string
  supports_ar: boolean
  ar_model_url?: string | null
  ar_scale: string
  ar_rotation: string
  ar_position: string
  ar_auto_sync: number
  status: 'draft' | 'active' | 'inactive'
  cover_url: string
  gallery_urls: string[]
  sort_order: number
}

type Banner = {
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

type Order = {
  id: number
  order_no: string
  status: 'pending_payment' | 'paid' | 'preparing' | 'shipped' | 'completed' | 'cancelled' | 'refunding' | 'refunded' | 'failed'
  total_cents: number
  subtotal_cents: number
  shipping_fee_cents: number
  discount_cents: number
  receiver_name: string
  receiver_phone: string
  receiver_address: string
  buyer_note: string
  fulfillment_type: 'delivery' | 'pickup'
  pickup_slot: string
  pickup_code: string
  invoice_type: 'none' | 'personal' | 'company'
  invoice_title: string
  invoice_tax_number: string
  invoice_email: string
  logistics_company: string
  tracking_no: string
  created_at?: string | null
  paid_at?: string | null
  items: Array<{ product_id: number; product_name: string; unit_price_cents: number; quantity: number }>
}

type Dashboard = {
  product_count: number
  active_product_count: number
  low_stock_count: number
  pending_order_count: number
  paid_order_count: number
  today_order_count: number
  today_revenue_cents: number
  total_revenue_cents: number
  user_count: number
}

type Payment = {
  id: number
  order_id: number
  provider: string
  status: 'created' | 'pending' | 'succeeded' | 'failed' | 'closed' | 'refunded'
  out_trade_no: string
  transaction_id: string
  failure_reason: string
  created_at?: string | null
  updated_at?: string | null
  notified_at?: string | null
}

type Coupon = {
  id: number
  code: string
  name: string
  description: string
  amount_cents: number
  minimum_cents: number
  total_quantity: number
  claimed_quantity: number
  valid_from: string
  valid_until?: string | null
  is_active: boolean
}

type Refund = {
  id: number
  order_id: number
  out_refund_no: string
  refund_id: string
  amount_cents: number
  reason: string
  previous_status: Order['status']
  status: string
  created_at: string
  updated_at: string
}

type User = {
  id: number
  nickname: string
  phone: string
  avatar_color: string
  wechat_openid?: string | null
  points: number
  created_at: string
}

type Pet = {
  id: number
  user_id: number
  name: string
  level: number
  exp: number
  mood: number
  hunger: number
  next_level_exp: number
  reward: string
  asset_key: string
}

type Asset = {
  id: number
  filename: string
  original_name: string
  content_type: string
  url: string
  size: number
  asset_type: string
  created_at: string
}

type Setting = {
  key: string
  value: string
  label: string
  group: string
}

type AuditLog = {
  id: number
  admin_id: number | null
  action: string
  entity: string
  entity_id: string
  detail: string
  created_at: string
}

type ModuleKey = 'dashboard' | 'products' | 'categories' | 'banners' | 'orders' | 'payments' | 'coupons' | 'users' | 'pets' | 'assets' | 'settings' | 'admins' | 'audit'

const modules: Array<{ key: ModuleKey; label: string; description: string }> = [
  { key: 'dashboard', label: '总览', description: '店铺运营、订单与内容配置概览' },
  { key: 'products', label: '商品', description: '维护商品资料、库存、价格与陈列状态' },
  { key: 'categories', label: '分类', description: '维护小程序商品分类与排序' },
  { key: 'banners', label: '轮播', description: '配置首页主视觉、宣传位与跳转' },
  { key: 'orders', label: '订单', description: '处理订单、备货、发货、签收与售后状态' },
  { key: 'payments', label: '支付流水', description: '核对微信支付单、交易号、通知与失败原因' },
  { key: 'coupons', label: '优惠券', description: '创建、上下架和管理会员优惠礼券' },
  { key: 'users', label: '用户', description: '查看会员资料、积分和微信绑定状态' },
  { key: 'pets', label: '宠物积分', description: '查看会员宠物等级、经验与权益' },
  { key: 'assets', label: '素材', description: '上传商品图、轮播图和 AR 模型文件' },
  { key: 'settings', label: '配置', description: '维护门店展示与配送规则；支付密钥仅由服务端环境变量管理' },
  { key: 'admins', label: '管理员', description: '超级管理员可维护后台账号' },
  { key: 'audit', label: '审计', description: '查看后台操作记录' }
]

const emptyProduct: Omit<Product, 'id'> = {
  name: '',
  subtitle: '',
  description: '',
  category_slug: 'rings',
  material: '18K金',
  price_cents: 0,
  original_price_cents: 0,
  stock: 0,
  sales: 0,
  is_featured: false,
  free_shipping: false,
  tags: [],
  image_color: '#B89A63',
  supports_ar: false,
  ar_model_url: '',
  ar_scale: '0.22 0.22 0.22',
  ar_rotation: '0 0 0',
  ar_position: '0 0.08 0',
  ar_auto_sync: 9,
  status: 'draft',
  cover_url: '',
  gallery_urls: [],
  sort_order: 0
}

const localDateValue = (offsetDays = 0) => {
  const date = new Date(Date.now() + offsetDays * 86400000)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

const emptyCoupon: Omit<Coupon, 'id' | 'claimed_quantity'> = {
  code: '', name: '', description: '', amount_cents: 0, minimum_cents: 0,
  total_quantity: 0, valid_from: localDateValue(), valid_until: localDateValue(30), is_active: true
}

const emptyBanner: Omit<Banner, 'id'> = {
  title: '',
  subtitle: '',
  image_url: '',
  image_color: '#111111',
  placement: 'home_hero',
  link_type: 'none',
  link_value: '',
  sort_order: 0,
  is_active: true
}

function money(cents: number) {
  return `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`
}

function cents(value: string) {
  return Math.max(0, Math.round(Number(value || 0) * 100))
}

function toLocalInput(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

function includesQuery(query: string, values: Array<string | number | null | undefined>) {
  const normalized = query.trim().toLowerCase()
  return !normalized || values.some((value) => String(value ?? '').toLowerCase().includes(normalized))
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

const orderStatusText: Record<Order['status'], string> = {
  pending_payment: '待支付', paid: '已支付', preparing: '备货中', shipped: '已发货', completed: '已完成',
  cancelled: '已取消', refunding: '退款中', refunded: '已退款', failed: '支付异常'
}

const paymentStatusText: Record<Payment['status'], string> = {
  created: '已创建', pending: '待确认', succeeded: '支付成功', failed: '失败', closed: '已关闭', refunded: '已退款'
}

const refundStatusText: Record<string, string> = {
  processing: '处理中', success: '退款成功', failed: '提交失败', closed: '已关闭', abnormal: '退款异常'
}

const orderTransitions: Record<Order['status'], Order['status'][]> = {
  pending_payment: ['pending_payment', 'cancelled', 'failed'],
  paid: ['paid', 'preparing'], preparing: ['preparing', 'shipped'], shipped: ['shipped', 'completed'], completed: ['completed'],
  cancelled: ['cancelled'], refunding: ['refunding'], refunded: ['refunded'], failed: ['failed']
}

export default function BackstagePage() {
  const [token, setToken] = useState('')
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [active, setActive] = useState<ModuleKey>('dashboard')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState(process.env.NODE_ENV === 'development' ? 'admin@xihong.local' : '')
  const [password, setPassword] = useState(process.env.NODE_ENV === 'development' ? 'XihongAdmin123!' : '')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [banners, setBanners] = useState<Banner[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [refunds, setRefunds] = useState<Refund[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [pets, setPets] = useState<Pet[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [settings, setSettings] = useState<Setting[]>([])
  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [audit, setAudit] = useState<AuditLog[]>([])
  const [productForm, setProductForm] = useState<Omit<Product, 'id'>>(emptyProduct)
  const [editingProductId, setEditingProductId] = useState<number | null>(null)
  const [categoryForm, setCategoryForm] = useState<Omit<Category, 'id'>>({ name: '', slug: '', sort_order: 0, is_active: true })
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null)
  const [bannerForm, setBannerForm] = useState<Omit<Banner, 'id'>>(emptyBanner)
  const [editingBannerId, setEditingBannerId] = useState<number | null>(null)
  const [couponForm, setCouponForm] = useState<Omit<Coupon, 'id' | 'claimed_quantity'>>(emptyCoupon)
  const [editingCouponId, setEditingCouponId] = useState<number | null>(null)
  const [orderFilter, setOrderFilter] = useState<Order['status'] | 'all'>('all')
  const [orderSearch, setOrderSearch] = useState('')
  const [orderPage, setOrderPage] = useState(1)
  const [orderDateFrom, setOrderDateFrom] = useState('')
  const [orderDateTo, setOrderDateTo] = useState('')
  const [logisticsDraft, setLogisticsDraft] = useState<Record<number, { company: string; tracking: string }>>({})
  const [busy, setBusy] = useState(false)
  const [adminForm, setAdminForm] = useState({ email: '', name: '', password: '', role: 'admin' as 'super_admin' | 'admin', is_active: true })
  const [queries, setQueries] = useState<Partial<Record<ModuleKey, string>>>({})
  const [productStatus, setProductStatus] = useState<Product['status'] | 'all'>('all')
  const [productCategory, setProductCategory] = useState('all')
  const [categoryStatus, setCategoryStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [bannerStatus, setBannerStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [paymentStatus, setPaymentStatus] = useState<Payment['status'] | 'all'>('all')
  const [couponStatus, setCouponStatus] = useState<'all' | 'active' | 'inactive' | 'expired'>('all')
  const [userBinding, setUserBinding] = useState<'all' | 'phone' | 'wechat' | 'unbound'>('all')
  const [assetType, setAssetType] = useState<'all' | 'image' | 'model'>('all')
  const [settingGroup, setSettingGroup] = useState('all')
  const [adminStatus, setAdminStatus] = useState<'all' | 'active' | 'inactive'>('all')

  const filteredOrders = useMemo(() => orders.filter((order) => {
    const statusMatch = orderFilter === 'all' || order.status === orderFilter
    const queryMatch = includesQuery(orderSearch, [order.id, order.order_no, order.receiver_name, order.receiver_phone, order.receiver_address, order.tracking_no, order.invoice_title, order.pickup_code, ...order.items.map((item) => item.product_name)])
    const createdAt = order.created_at ? new Date(order.created_at).getTime() : 0
    const fromMatch = !orderDateFrom || createdAt >= new Date(`${orderDateFrom}T00:00:00`).getTime()
    const toMatch = !orderDateTo || createdAt <= new Date(`${orderDateTo}T23:59:59.999`).getTime()
    return statusMatch && queryMatch && fromMatch && toMatch
  }), [orderDateFrom, orderDateTo, orderFilter, orderSearch, orders])
  const orderPageCount = Math.max(1, Math.ceil(filteredOrders.length / 8))
  const visibleOrders = useMemo(() => filteredOrders.slice((orderPage - 1) * 8, orderPage * 8), [filteredOrders, orderPage])
  const filteredProducts = useMemo(() => products.filter((item) => (productStatus === 'all' || item.status === productStatus) && (productCategory === 'all' || item.category_slug === productCategory) && includesQuery(queries.products || '', [item.id, item.name, item.subtitle, item.material, item.category_slug, ...item.tags])), [productCategory, productStatus, products, queries.products])
  const filteredCategories = useMemo(() => categories.filter((item) => (categoryStatus === 'all' || item.is_active === (categoryStatus === 'active')) && includesQuery(queries.categories || '', [item.id, item.name, item.slug])), [categories, categoryStatus, queries.categories])
  const filteredBanners = useMemo(() => banners.filter((item) => (bannerStatus === 'all' || item.is_active === (bannerStatus === 'active')) && includesQuery(queries.banners || '', [item.id, item.title, item.subtitle, item.placement, item.link_value])), [bannerStatus, banners, queries.banners])
  const filteredPayments = useMemo(() => payments.filter((item) => (paymentStatus === 'all' || item.status === paymentStatus) && includesQuery(queries.payments || '', [item.id, item.order_id, item.out_trade_no, item.transaction_id, item.failure_reason])), [paymentStatus, payments, queries.payments])
  const filteredRefunds = useMemo(() => refunds.filter((item) => includesQuery(queries.payments || '', [item.id, item.order_id, item.out_refund_no, item.refund_id, item.reason, item.status])), [queries.payments, refunds])
  const filteredCoupons = useMemo(() => coupons.filter((item) => {
    const expired = Boolean(item.valid_until && new Date(item.valid_until).getTime() < Date.now())
    const statusMatch = couponStatus === 'all' || (couponStatus === 'expired' ? expired : item.is_active === (couponStatus === 'active') && !expired)
    return statusMatch && includesQuery(queries.coupons || '', [item.id, item.code, item.name, item.description])
  }), [couponStatus, coupons, queries.coupons])
  const filteredUsers = useMemo(() => users.filter((item) => {
    const bindingMatch = userBinding === 'all' || (userBinding === 'phone' ? Boolean(item.phone) : userBinding === 'wechat' ? Boolean(item.wechat_openid) : !item.phone && !item.wechat_openid)
    return bindingMatch && includesQuery(queries.users || '', [item.id, item.nickname, item.phone, item.wechat_openid])
  }), [queries.users, userBinding, users])
  const filteredPets = useMemo(() => pets.filter((item) => {
    const owner = users.find((user) => user.id === item.user_id)
    return includesQuery(queries.pets || '', [item.id, item.user_id, item.name, item.reward, owner?.nickname, owner?.phone])
  }), [pets, queries.pets, users])
  const filteredAssets = useMemo(() => assets.filter((item) => (assetType === 'all' || item.asset_type === assetType) && includesQuery(queries.assets || '', [item.id, item.original_name, item.filename, item.content_type])), [assetType, assets, queries.assets])
  const settingGroups = useMemo(() => [...new Set(settings.map((item) => item.group))], [settings])
  const filteredSettings = useMemo(() => settings.filter((item) => (settingGroup === 'all' || item.group === settingGroup) && includesQuery(queries.settings || '', [item.key, item.label, item.group, item.value])), [queries.settings, settingGroup, settings])
  const filteredAdmins = useMemo(() => admins.filter((item) => (adminStatus === 'all' || item.is_active === (adminStatus === 'active')) && includesQuery(queries.admins || '', [item.id, item.name, item.email, item.role])), [adminStatus, admins, queries.admins])
  const filteredAudit = useMemo(() => audit.filter((item) => includesQuery(queries.audit || '', [item.id, item.admin_id, item.action, item.entity, item.entity_id, item.detail])), [audit, queries.audit])
  const activeModule = modules.find((item) => item.key === active) || modules[0]

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers
      }
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.detail || '请求失败')
    }
    return response.json()
  }

  async function loadAll(nextToken = token) {
    setBusy(true)
    try {
      const headers = nextToken ? { Authorization: `Bearer ${nextToken}` } : undefined
      const request = async <T,>(path: string): Promise<T> => {
        const response = await fetch(`${API_BASE}${path}`, { headers })
        if (!response.ok) throw new Error(`数据同步失败：${path}`)
        return response.json()
      }
      const [me, nextDashboard, nextProducts, nextCategories, nextBanners, nextOrders, nextPayments, nextRefunds, nextCoupons, nextUsers, nextPets, nextAssets, nextSettings, nextAudit] = await Promise.all([
      request<AdminUser>('/api/admin/me'),
      request<Dashboard>('/api/admin/dashboard'),
      request<Product[]>('/api/admin/products'),
      request<Category[]>('/api/admin/categories'),
      request<Banner[]>('/api/admin/banners'),
      request<Order[]>('/api/admin/orders'),
      request<Payment[]>('/api/admin/payments'),
      request<Refund[]>('/api/admin/refunds'),
      request<Coupon[]>('/api/admin/coupons'),
      request<User[]>('/api/admin/users'),
      request<Pet[]>('/api/admin/pets'),
      request<Asset[]>('/api/admin/assets'),
      request<Setting[]>('/api/admin/settings'),
      request<AuditLog[]>('/api/admin/audit-logs')
      ])
      setAdmin(me)
      setDashboard(nextDashboard)
      setProducts(nextProducts)
      setCategories(nextCategories)
      setBanners(nextBanners)
      setOrders(nextOrders)
      setPayments(nextPayments)
      setRefunds(nextRefunds)
      setCoupons(nextCoupons)
      setUsers(nextUsers)
      setPets(nextPets)
      setAssets(nextAssets)
      setSettings(nextSettings)
      setAudit(nextAudit)
      if (me.role === 'super_admin') {
        const nextAdmins = await request<AdminUser[]>('/api/admin/admin-users')
        setAdmins(nextAdmins)
      }
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const stored = window.localStorage.getItem('xihong_admin_token')
    if (stored) {
      setToken(stored)
      loadAll(stored).catch(() => window.localStorage.removeItem('xihong_admin_token'))
    }
  }, [])

  useEffect(() => { setOrderPage(1) }, [orderDateFrom, orderDateTo, orderFilter, orderSearch])
  useEffect(() => { if (orderPage > orderPageCount) setOrderPage(orderPageCount) }, [orderPage, orderPageCount])
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 4200)
    return () => window.clearTimeout(timer)
  }, [message])

  async function login(event: FormEvent) {
    event.preventDefault()
    try {
      const data = await api<{ access_token: string }>('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      })
      setToken(data.access_token)
      window.localStorage.setItem('xihong_admin_token', data.access_token)
      await loadAll(data.access_token)
      setMessage('登录成功')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '登录失败')
    }
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault()
    const payload = { ...productForm, ar_model_url: productForm.ar_model_url || null }
    const path = editingProductId ? `/api/admin/products/${editingProductId}` : '/api/admin/products'
    const method = editingProductId ? 'PUT' : 'POST'
    const saved = await api<Product>(path, { method, body: JSON.stringify(payload) })
    setProducts((items) => editingProductId ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items])
    setProductForm(emptyProduct)
    setEditingProductId(null)
    setMessage('商品已保存')
  }

  async function removeProduct(id: number) {
    if (!window.confirm('确定删除该商品？已有订单中的商品快照不会删除。')) return
    await api(`/api/admin/products/${id}`, { method: 'DELETE' })
    setProducts((items) => items.filter((item) => item.id !== id))
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault()
    const path = editingCategoryId ? `/api/admin/categories/${editingCategoryId}` : '/api/admin/categories'
    const method = editingCategoryId ? 'PUT' : 'POST'
    const saved = await api<Category>(path, { method, body: JSON.stringify(categoryForm) })
    setCategories((items) => editingCategoryId ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved])
    setCategoryForm({ name: '', slug: '', sort_order: 0, is_active: true })
    setEditingCategoryId(null)
    setMessage('分类已保存')
  }

  async function removeCategory(id: number) {
    if (!window.confirm('确定删除该分类？请先确认没有商品继续使用该分类。')) return
    await api(`/api/admin/categories/${id}`, { method: 'DELETE' })
    setCategories((items) => items.filter((item) => item.id !== id))
    setMessage('分类已删除')
  }

  async function saveBanner(event: FormEvent) {
    event.preventDefault()
    const path = editingBannerId ? `/api/admin/banners/${editingBannerId}` : '/api/admin/banners'
    const method = editingBannerId ? 'PUT' : 'POST'
    const saved = await api<Banner>(path, { method, body: JSON.stringify(bannerForm) })
    setBanners((items) => editingBannerId ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved])
    setBannerForm(emptyBanner)
    setEditingBannerId(null)
    setMessage('轮播已保存')
  }

  async function removeBanner(id: number) {
    if (!window.confirm('确定删除该轮播内容？')) return
    await api(`/api/admin/banners/${id}`, { method: 'DELETE' })
    setBanners((items) => items.filter((item) => item.id !== id))
    setMessage('轮播已删除')
  }

  async function updateOrderStatus(order: Order, status: Order['status']) {
    const logistics = logisticsDraft[order.id] || { company: order.logistics_company, tracking: order.tracking_no }
    if (status === 'shipped' && (!logistics.company.trim() || !logistics.tracking.trim())) {
      setMessage('发货前请填写物流公司与运单号')
      return
    }
    const saved = await api<Order>(`/api/admin/orders/${order.id}/status`, { method: 'PUT', body: JSON.stringify({ status, logistics_company: logistics.company, tracking_no: logistics.tracking }) })
    setOrders((items) => items.map((item) => item.id === saved.id ? saved : item))
    setMessage(`订单 ${saved.order_no} 已更新为 ${orderStatusText[saved.status]}`)
  }

  async function saveCoupon(event: FormEvent) {
    event.preventDefault()
    if (couponForm.valid_until && new Date(couponForm.valid_until) <= new Date(couponForm.valid_from)) {
      setMessage('优惠券结束时间必须晚于开始时间')
      return
    }
    const payload = {
      ...couponForm,
      code: couponForm.code.trim().toUpperCase(),
      valid_from: new Date(couponForm.valid_from).toISOString(),
      valid_until: couponForm.valid_until ? new Date(couponForm.valid_until).toISOString() : null
    }
    const path = editingCouponId ? `/api/admin/coupons/${editingCouponId}` : '/api/admin/coupons'
    const saved = await api<Coupon>(path, { method: editingCouponId ? 'PUT' : 'POST', body: JSON.stringify(payload) })
    setCoupons((items) => editingCouponId ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items])
    setCouponForm({ ...emptyCoupon, valid_from: localDateValue(), valid_until: localDateValue(30) })
    setEditingCouponId(null)
    setMessage('优惠券已保存')
  }

  async function requestRefund(order: Order) {
    const reason = window.prompt(`将为订单 ${order.order_no} 原路全额退款 ${money(order.total_cents)}。请输入退款原因：`, '客户协商退款')
    if (!reason?.trim()) return
    if (!window.confirm('退款提交后将进入微信支付退款流程，确定继续吗？')) return
    const refund = await api<Refund>(`/api/admin/orders/${order.id}/refund`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) })
    setRefunds((items) => [refund, ...items.filter((item) => item.id !== refund.id)])
    await loadAll()
    setMessage(`退款单 ${refund.out_refund_no} 已提交，当前状态：${refund.status}`)
  }

  async function uploadAsset(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    const saved = await api<Asset>('/api/admin/assets', { method: 'POST', body: form })
    setAssets((items) => [saved, ...items])
    event.target.value = ''
    setMessage('素材已上传')
  }

  async function removeAsset(asset: Asset) {
    if (!window.confirm(`确定删除素材“${asset.original_name}”？已经引用该地址的页面可能无法显示。`)) return
    await api(`/api/admin/assets/${asset.id}`, { method: 'DELETE' })
    setAssets((items) => items.filter((item) => item.id !== asset.id))
    setMessage('素材已删除')
  }

  async function adjustUserPoints(user: User) {
    const raw = window.prompt(`调整 ${user.nickname} 的积分（当前 ${user.points}）。增加请输入正数，扣减请输入负数：`, '10')
    if (raw === null) return
    const delta = Number(raw)
    if (!Number.isInteger(delta) || delta === 0) {
      setMessage('请输入非 0 的整数积分')
      return
    }
    const note = window.prompt('请输入调整原因：', '后台人工调整')
    if (!note?.trim()) return
    const saved = await api<User>(`/api/admin/users/${user.id}/points`, { method: 'POST', body: JSON.stringify({ delta, note: note.trim() }) })
    setUsers((items) => items.map((item) => item.id === saved.id ? saved : item))
    setMessage(`${saved.nickname} 积分已调整为 ${saved.points}`)
  }

  async function saveSetting(setting: Setting, value: string) {
    const saved = await api<Setting>(`/api/admin/settings/${setting.key}`, {
      method: 'PUT',
      body: JSON.stringify({ value, label: setting.label, group: setting.group })
    })
    setSettings((items) => items.map((item) => item.key === saved.key ? saved : item))
  }

  async function createAdmin(event: FormEvent) {
    event.preventDefault()
    const saved = await api<AdminUser>('/api/admin/admin-users', { method: 'POST', body: JSON.stringify(adminForm) })
    setAdmins((items) => [saved, ...items])
    setAdminForm({ email: '', name: '', password: '', role: 'admin', is_active: true })
    setMessage('管理员账号已创建')
  }

  async function toggleAdminAccount(target: AdminUser) {
    if (target.id === admin?.id && target.is_active) {
      setMessage('不能停用当前登录账号')
      return
    }
    const saved = await api<AdminUser>(`/api/admin/admin-users/${target.id}`, { method: 'PUT', body: JSON.stringify({ is_active: !target.is_active }) })
    setAdmins((items) => items.map((item) => item.id === saved.id ? saved : item))
    setMessage(`${saved.name} 已${saved.is_active ? '启用' : '停用'}`)
  }

  if (!admin) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <p className="brand">Xihong Jewelry</p>
          <h1>玺鸿珠宝后台</h1>
          <form onSubmit={login} className="form">
            <label>邮箱<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button className="primary" type="submit">进入管理台</button>
          </form>
          {message && <p className="message">{message}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <p className="brand">Xihong Jewelry</p>
          <h1>玺鸿后台</h1>
          <span>Commerce Console</span>
        </div>
        <nav>
          {modules.map((item) => (
            <button key={item.key} className={active === item.key ? 'active' : ''} onClick={() => setActive(item.key)}>{item.label}</button>
          ))}
        </nav>
        <div className="admin-box">
          <strong>{admin.name}</strong>
          <span className="role-pill">{admin.role === 'super_admin' ? '超级管理员' : '管理员'}</span>
          <button onClick={() => { window.localStorage.removeItem('xihong_admin_token'); setAdmin(null); setToken('') }}>退出</button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p>天津玺鸿珠宝贸易有限公司</p>
            <h2>{activeModule.label}</h2>
            <span>{activeModule.description}</span>
          </div>
          <div className="top-actions">
            <span className="environment"><i /> API 已连接</span>
            <button className="ghost" disabled={busy} onClick={() => loadAll().catch((error) => setMessage(error.message))}>{busy ? '同步中…' : '刷新数据'}</button>
          </div>
        </header>
        {message && <p className="message">{message}</p>}

        <div className="content-body" key={active}>
        {active === 'dashboard' && (
          <section className="dashboard">
            <div className="dashboard-intro"><div><p>COMMERCE PULSE</p><h3>今日经营简报</h3></div><span>{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</span></div>
            <div className="grid stats">
              <article className="panel stat hero-stat"><span>今日成交</span><strong>{money(dashboard?.today_revenue_cents || 0)}</strong><small>{dashboard?.today_order_count || 0} 笔新订单</small></article>
              <article className="panel stat"><span>累计成交</span><strong>{money(dashboard?.total_revenue_cents || 0)}</strong><small>{dashboard?.paid_order_count || 0} 笔已付款</small></article>
              <article className="panel stat"><span>待处理订单</span><strong>{dashboard?.pending_order_count || 0}</strong><small>待付款库存占用</small></article>
              <article className={`panel stat ${(dashboard?.low_stock_count || 0) > 0 ? 'warning' : ''}`}><span>库存预警</span><strong>{dashboard?.low_stock_count || 0}</strong><small>低于安全库存</small></article>
              <article className="panel stat"><span>会员规模</span><strong>{dashboard?.user_count || 0}</strong><small>{dashboard?.active_product_count || 0} 款在售作品</small></article>
            </div>
            <div className="dashboard-columns">
              <section className="panel table-panel"><div className="panel-heading"><div><p>FULFILLMENT</p><h3>最近订单</h3></div><button onClick={() => setActive('orders')}>管理全部</button></div>{orders.slice(0, 6).map((order) => <div className="row" key={order.id}><span className={`status-dot ${order.status}`} /><div><strong>{order.order_no}</strong><small>{order.receiver_name} · {orderStatusText[order.status]}</small></div><b>{money(order.total_cents)}</b></div>)}{!orders.length && <Empty text="暂无订单数据" />}</section>
              <section className="panel table-panel"><div className="panel-heading"><div><p>INVENTORY</p><h3>库存关注</h3></div><button onClick={() => setActive('products')}>商品管理</button></div>{[...products].sort((a, b) => a.stock - b.stock).slice(0, 6).map((product) => <div className="row inventory-row" key={product.id}><span className="swatch" style={{ background: product.image_color }} /><div><strong>{product.name}</strong><small>已售 {product.sales} · {product.status === 'active' ? '在售' : '未上架'}</small></div><span className={product.stock <= 5 ? 'stock-low' : 'stock-ok'}>{product.stock} 件</span></div>)}{!products.length && <Empty text="暂无商品数据" />}</section>
            </div>
          </section>
        )}

        {active === 'products' && (
          <section className="split">
            <form className="panel form" onSubmit={(event) => saveProduct(event).catch((error) => setMessage(error.message))}>
              <FormHeading title={editingProductId ? '编辑商品' : '新增商品'} editing={Boolean(editingProductId)} onCancel={() => { setProductForm(emptyProduct); setEditingProductId(null) }} />
              <label>名称<input value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} required /></label>
              <label>副标题<input value={productForm.subtitle} onChange={(e) => setProductForm({ ...productForm, subtitle: e.target.value })} /></label>
              <label>分类<select value={productForm.category_slug} onChange={(e) => setProductForm({ ...productForm, category_slug: e.target.value })}>{categories.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
              <label>材质<input value={productForm.material} onChange={(e) => setProductForm({ ...productForm, material: e.target.value })} /></label>
              <div className="two"><label>售价（元）<input type="number" min="0" value={productForm.price_cents / 100} onChange={(e) => setProductForm({ ...productForm, price_cents: cents(e.target.value) })} /></label><label>划线价（元）<input type="number" min="0" value={productForm.original_price_cents / 100} onChange={(e) => setProductForm({ ...productForm, original_price_cents: cents(e.target.value) })} /></label></div>
              <div className="two"><label>库存<input type="number" min="0" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: Number(e.target.value) })} /></label><label>陈列排序<input type="number" value={productForm.sort_order} onChange={(e) => setProductForm({ ...productForm, sort_order: Number(e.target.value) })} /></label></div>
              <label>商品标签（逗号分隔）<input value={productForm.tags.join(', ')} onChange={(e) => setProductForm({ ...productForm, tags: e.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })} placeholder="新品, 限定, 礼赠" /></label>
              <label>状态<select value={productForm.status} onChange={(e) => setProductForm({ ...productForm, status: e.target.value as Product['status'] })}><option value="draft">草稿</option><option value="active">上架</option><option value="inactive">下架</option></select></label>
              <label>封面 URL<input value={productForm.cover_url} onChange={(e) => setProductForm({ ...productForm, cover_url: e.target.value })} /></label>
              <label className="check"><input type="checkbox" checked={productForm.is_featured} onChange={(e) => setProductForm({ ...productForm, is_featured: e.target.checked })} /> 首页重点陈列</label>
              <label className="check"><input type="checkbox" checked={productForm.free_shipping} onChange={(e) => setProductForm({ ...productForm, free_shipping: e.target.checked })} /> 此商品单独结算免运费</label>
              <label>详情<textarea value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} /></label>
              <button className="primary" type="submit">保存商品</button>
            </form>
            <div className="panel table-panel">
              <PanelTitle eyebrow="CATALOG" title="商品列表" count={`${filteredProducts.length} / ${products.length} 件`} />
              <QueryToolbar value={queries.products || ''} onChange={(value) => setQueries((current) => ({ ...current, products: value }))} placeholder="搜索商品名、材质、标签或编号" onExport={() => downloadCsv('商品列表.csv', [['编号', '商品名', '分类', '材质', '售价', '库存', '销量', '状态'], ...filteredProducts.map((item) => [item.id, item.name, item.category_slug, item.material, item.price_cents / 100, item.stock, item.sales, item.status])])}>
                <select aria-label="商品分类" value={productCategory} onChange={(event) => setProductCategory(event.target.value)}><option value="all">全部分类</option>{categories.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select>
                <select aria-label="商品状态" value={productStatus} onChange={(event) => setProductStatus(event.target.value as typeof productStatus)}><option value="all">全部状态</option><option value="active">已上架</option><option value="draft">草稿</option><option value="inactive">已下架</option></select>
              </QueryToolbar>
              {filteredProducts.map((item) => (
                <div className="row" key={item.id}>
                  <span className="swatch" style={{ background: item.image_color }} />
                  <div><strong>{item.name}</strong><small>{item.category_slug} · {item.material} · 库存 {item.stock} · 已售 {item.sales}{item.free_shipping ? ' · 单品包邮' : ''}</small></div>
                  <b>{money(item.price_cents)}</b>
                  <button onClick={() => { setProductForm({ ...item }); setEditingProductId(item.id) }}>编辑</button>
                  <button className="danger-action" onClick={() => removeProduct(item.id).catch((error) => setMessage(error.message))}>删除</button>
                </div>
              ))}
              {!filteredProducts.length && <Empty text="没有符合条件的商品" />}
            </div>
          </section>
        )}

        {active === 'categories' && (
          <section className="split">
            <form className="panel form" onSubmit={(event) => saveCategory(event).catch((error) => setMessage(error.message))}>
              <FormHeading title={editingCategoryId ? '编辑分类' : '新增分类'} editing={Boolean(editingCategoryId)} onCancel={() => { setCategoryForm({ name: '', slug: '', sort_order: 0, is_active: true }); setEditingCategoryId(null) }} />
              <label>名称<input required value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} /></label>
              <label>Slug<input required value={categoryForm.slug} onChange={(e) => setCategoryForm({ ...categoryForm, slug: e.target.value })} /></label>
              <label>排序<input type="number" value={categoryForm.sort_order} onChange={(e) => setCategoryForm({ ...categoryForm, sort_order: Number(e.target.value) })} /></label>
              <label className="check"><input type="checkbox" checked={categoryForm.is_active} onChange={(e) => setCategoryForm({ ...categoryForm, is_active: e.target.checked })} /> 启用</label>
              <button className="primary">保存分类</button>
            </form>
            <TablePanel title="分类列表">
              <QueryToolbar value={queries.categories || ''} onChange={(value) => setQueries((current) => ({ ...current, categories: value }))} placeholder="搜索分类名称或 Slug">
                <select aria-label="分类状态" value={categoryStatus} onChange={(event) => setCategoryStatus(event.target.value as typeof categoryStatus)}><option value="all">全部状态</option><option value="active">已启用</option><option value="inactive">已停用</option></select>
              </QueryToolbar>
              {filteredCategories.map((item) => <div className="row" key={item.id}><span className={`status-dot ${item.is_active ? 'active' : ''}`} /><div><strong>{item.name}</strong><small>{item.slug} · 排序 {item.sort_order} · {item.is_active ? '启用' : '停用'}</small></div><button onClick={() => { setCategoryForm(item); setEditingCategoryId(item.id) }}>编辑</button><button className="danger-action" onClick={() => removeCategory(item.id).catch((error) => setMessage(error.message))}>删除</button></div>)}
              {!filteredCategories.length && <Empty text="没有符合条件的分类" />}
            </TablePanel>
          </section>
        )}

        {active === 'banners' && (
          <section className="split">
            <form className="panel form" onSubmit={(event) => saveBanner(event).catch((error) => setMessage(error.message))}>
              <FormHeading title={editingBannerId ? '编辑轮播' : '新增轮播'} editing={Boolean(editingBannerId)} onCancel={() => { setBannerForm(emptyBanner); setEditingBannerId(null) }} />
              <label>标题<input required value={bannerForm.title} onChange={(e) => setBannerForm({ ...bannerForm, title: e.target.value })} /></label>
              <label>副标题<input value={bannerForm.subtitle} onChange={(e) => setBannerForm({ ...bannerForm, subtitle: e.target.value })} /></label>
              <label>图片 URL<input value={bannerForm.image_url} onChange={(e) => setBannerForm({ ...bannerForm, image_url: e.target.value })} /></label>
              <label>色块<input value={bannerForm.image_color} onChange={(e) => setBannerForm({ ...bannerForm, image_color: e.target.value })} /></label>
              <label>位置<input value={bannerForm.placement} onChange={(e) => setBannerForm({ ...bannerForm, placement: e.target.value })} /></label>
              <label>跳转值<input value={bannerForm.link_value} onChange={(e) => setBannerForm({ ...bannerForm, link_value: e.target.value })} /></label>
              <div className="two"><label>排序<input type="number" value={bannerForm.sort_order} onChange={(e) => setBannerForm({ ...bannerForm, sort_order: Number(e.target.value) })} /></label><label>跳转类型<select value={bannerForm.link_type} onChange={(e) => setBannerForm({ ...bannerForm, link_type: e.target.value })}><option value="none">不跳转</option><option value="product">商品</option><option value="page">页面</option><option value="webview">网页</option></select></label></div>
              <label className="check"><input type="checkbox" checked={bannerForm.is_active} onChange={(e) => setBannerForm({ ...bannerForm, is_active: e.target.checked })} /> 启用</label>
              <button className="primary">保存轮播</button>
            </form>
            <TablePanel title="轮播列表">
              <QueryToolbar value={queries.banners || ''} onChange={(value) => setQueries((current) => ({ ...current, banners: value }))} placeholder="搜索标题、位置或跳转值">
                <select aria-label="轮播状态" value={bannerStatus} onChange={(event) => setBannerStatus(event.target.value as typeof bannerStatus)}><option value="all">全部状态</option><option value="active">已启用</option><option value="inactive">已停用</option></select>
              </QueryToolbar>
              {filteredBanners.map((item) => <div className="row" key={item.id}><span className="swatch" style={{ background: item.image_color }} /><div><strong>{item.title}</strong><small>{item.placement} · 排序 {item.sort_order} · {item.is_active ? '启用' : '停用'}</small></div><button onClick={() => { setBannerForm(item); setEditingBannerId(item.id) }}>编辑</button><button className="danger-action" onClick={() => removeBanner(item.id).catch((error) => setMessage(error.message))}>删除</button></div>)}
              {!filteredBanners.length && <Empty text="没有符合条件的轮播内容" />}
            </TablePanel>
          </section>
        )}

        {active === 'orders' && (
          <section className="panel order-manager">
            <div className="panel-heading"><div><p>FULFILLMENT DESK</p><h3>订单履约</h3></div><span>{filteredOrders.length} / {orders.length} 笔</span></div>
            <div className="table-tools"><input value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} placeholder="搜索订单、会员、商品、手机、发票或运单号" /><select value={orderFilter} onChange={(event) => setOrderFilter(event.target.value as typeof orderFilter)}><option value="all">全部状态</option>{Object.entries(orderStatusText).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><label className="compact-field"><span>开始日期</span><input type="date" value={orderDateFrom} onChange={(event) => setOrderDateFrom(event.target.value)} /></label><label className="compact-field"><span>结束日期</span><input type="date" value={orderDateTo} onChange={(event) => setOrderDateTo(event.target.value)} /></label><button className="tool-action" onClick={() => downloadCsv('订单查询结果.csv', [['订单号', '状态', '履约方式', '收件人', '手机', '金额', '商品', '创建时间'], ...filteredOrders.map((order) => [order.order_no, orderStatusText[order.status], order.fulfillment_type === 'pickup' ? '到店自提' : '配送', order.receiver_name, order.receiver_phone, order.total_cents / 100, order.items.map((item) => `${item.product_name}×${item.quantity}`).join('；'), order.created_at])])}>导出结果</button></div>
            <div className="order-cards">{visibleOrders.map((order) => {
              const draft = logisticsDraft[order.id] || { company: order.logistics_company || '', tracking: order.tracking_no || '' }
              return <article className="admin-order" key={order.id}>
                <header><div><strong>{order.order_no}</strong><small>{order.created_at ? new Date(order.created_at).toLocaleString('zh-CN') : ''}</small></div><span className={`status-pill ${order.status}`}>{orderStatusText[order.status]}</span><b>{money(order.total_cents)}</b></header>
                <div className="order-summary"><div><span>{order.fulfillment_type === 'pickup' ? '到店自提' : '收货人'}</span><strong>{order.receiver_name} · {order.receiver_phone}</strong><small>{order.fulfillment_type === 'pickup' ? `${order.pickup_slot} · 口令 ${order.pickup_code}` : order.receiver_address}</small></div><div><span>商品</span><strong>{order.items.reduce((sum, item) => sum + item.quantity, 0)} 件作品</strong><small>{order.items.map((item) => `${item.product_name} ×${item.quantity}`).join('、')}</small></div><div><span>发票 / 优惠</span><strong>{order.invoice_type === 'none' ? '不开发票' : `${order.invoice_type === 'company' ? '企业' : '个人'} · ${order.invoice_title}`}</strong><small>{order.invoice_tax_number ? `税号 ${order.invoice_tax_number}` : order.buyer_note ? `备注：${order.buyer_note}` : `优惠 -${money(order.discount_cents)}`}</small></div></div>
                <div className="fulfillment">{order.fulfillment_type === 'delivery' && <><input value={draft.company} onChange={(event) => setLogisticsDraft((current) => ({ ...current, [order.id]: { ...draft, company: event.target.value } }))} placeholder="物流公司（发货时必填）" /><input value={draft.tracking} onChange={(event) => setLogisticsDraft((current) => ({ ...current, [order.id]: { ...draft, tracking: event.target.value } }))} placeholder="运单号（发货时必填）" /></>}<select value={order.status} onChange={(event) => updateOrderStatus(order, event.target.value as Order['status']).catch((error) => setMessage(error.message))}>{orderTransitions[order.status].map((value) => <option value={value} key={value}>{orderStatusText[value]}</option>)}</select>{(['paid', 'preparing', 'shipped', 'completed'] as Order['status'][]).includes(order.status) && <button className="refund-button" onClick={() => requestRefund(order).catch((error) => setMessage(error.message))}>原路退款</button>}</div>
              </article>
            })}{!visibleOrders.length && <Empty text="没有符合条件的订单" />}</div>
            {filteredOrders.length > 8 && <div className="pagination"><button disabled={orderPage <= 1} onClick={() => setOrderPage((page) => Math.max(1, page - 1))}>上一页</button><span>{orderPage} / {orderPageCount}</span><button disabled={orderPage >= orderPageCount} onClick={() => setOrderPage((page) => Math.min(orderPageCount, page + 1))}>下一页</button></div>}
          </section>
        )}

        {active === 'payments' && (
          <div className="payment-sections"><TablePanel title="微信支付流水">
            <QueryToolbar value={queries.payments || ''} onChange={(value) => setQueries((current) => ({ ...current, payments: value }))} placeholder="搜索商户单号、微信交易号、订单或失败原因" onExport={() => downloadCsv('支付流水.csv', [['商户订单号', '订单ID', '微信交易号', '状态', '失败原因', '更新时间'], ...filteredPayments.map((item) => [item.out_trade_no, item.order_id, item.transaction_id, paymentStatusText[item.status], item.failure_reason, item.updated_at])])}>
              <select aria-label="支付状态" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as typeof paymentStatus)}><option value="all">全部状态</option>{Object.entries(paymentStatusText).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </QueryToolbar>
            <div className="data-head payment-row"><span>商户订单号</span><span>关联订单</span><span>微信交易号 / 失败原因</span><span>更新时间</span><span>状态</span></div>
            {filteredPayments.map((payment) => <div className="data-row payment-row" key={payment.id}><code>{payment.out_trade_no || '—'}</code><button className="link-button" onClick={() => { setOrderSearch(String(payment.order_id)); setActive('orders') }}>#{payment.order_id}</button><div><strong>{payment.transaction_id || '尚无微信交易号'}</strong>{payment.failure_reason && <small>{payment.failure_reason}</small>}</div><span>{payment.updated_at ? new Date(payment.updated_at).toLocaleString('zh-CN') : '—'}</span><span className={`status-pill payment-${payment.status}`}>{paymentStatusText[payment.status]}</span></div>)}
            {!filteredPayments.length && <Empty text="没有符合条件的支付流水" />}
          </TablePanel><TablePanel title="退款记录"><div className="data-head refund-row"><span>退款单号</span><span>订单</span><span>金额 / 原因</span><span>更新时间</span><span>状态</span></div>{filteredRefunds.map((refund) => <div className="data-row refund-row" key={refund.id}><code>{refund.out_refund_no}</code><button className="link-button" onClick={() => { setOrderSearch(String(refund.order_id)); setActive('orders') }}>#{refund.order_id}</button><div><strong>{money(refund.amount_cents)}</strong><small>{refund.reason}</small></div><span>{new Date(refund.updated_at).toLocaleString('zh-CN')}</span><span className={`status-pill refund-${refund.status}`}>{refundStatusText[refund.status] || refund.status}</span></div>)}{!filteredRefunds.length && <Empty text="没有符合条件的退款记录" />}</TablePanel></div>
        )}

        {active === 'coupons' && (
          <section className="split coupon-admin">
            <form className="panel form" onSubmit={(event) => saveCoupon(event).catch((error) => setMessage(error.message))}>
              <FormHeading title={editingCouponId ? '编辑优惠券' : '创建优惠券'} editing={Boolean(editingCouponId)} onCancel={() => { setCouponForm({ ...emptyCoupon, valid_from: localDateValue(), valid_until: localDateValue(30) }); setEditingCouponId(null) }} />
              <div className="two"><label>券码<input required maxLength={32} value={couponForm.code} onChange={(event) => setCouponForm({ ...couponForm, code: event.target.value.toUpperCase() })} placeholder="WELCOME88" /></label><label>名称<input required value={couponForm.name} onChange={(event) => setCouponForm({ ...couponForm, name: event.target.value })} /></label></div>
              <label>使用说明<textarea value={couponForm.description} onChange={(event) => setCouponForm({ ...couponForm, description: event.target.value })} /></label>
              <div className="two"><label>优惠金额（元）<input required type="number" min="0.01" step="0.01" value={couponForm.amount_cents / 100} onChange={(event) => setCouponForm({ ...couponForm, amount_cents: cents(event.target.value) })} /></label><label>最低消费（元）<input type="number" min="0" value={couponForm.minimum_cents / 100} onChange={(event) => setCouponForm({ ...couponForm, minimum_cents: cents(event.target.value) })} /></label></div>
              <label>发行数量（0 表示不限）<input type="number" min="0" value={couponForm.total_quantity} onChange={(event) => setCouponForm({ ...couponForm, total_quantity: Number(event.target.value) })} /></label>
              <div className="two"><label>开始时间<input required type="datetime-local" value={couponForm.valid_from} onChange={(event) => setCouponForm({ ...couponForm, valid_from: event.target.value })} /></label><label>结束时间<input type="datetime-local" value={couponForm.valid_until || ''} onChange={(event) => setCouponForm({ ...couponForm, valid_until: event.target.value })} /></label></div>
              <label className="check"><input type="checkbox" checked={couponForm.is_active} onChange={(event) => setCouponForm({ ...couponForm, is_active: event.target.checked })} /> 立即启用</label>
              <button className="primary" type="submit">保存优惠券</button>
            </form>
            <div className="panel coupon-list-admin"><div className="panel-heading"><div><p>MEMBER BENEFITS</p><h3>优惠券列表</h3></div><span>{filteredCoupons.length} / {coupons.length} 张</span></div><QueryToolbar value={queries.coupons || ''} onChange={(value) => setQueries((current) => ({ ...current, coupons: value }))} placeholder="搜索券码、名称或使用说明"><select aria-label="优惠券状态" value={couponStatus} onChange={(event) => setCouponStatus(event.target.value as typeof couponStatus)}><option value="all">全部状态</option><option value="active">启用中</option><option value="inactive">已停用</option><option value="expired">已过期</option></select></QueryToolbar>{filteredCoupons.map((coupon) => { const expired = Boolean(coupon.valid_until && new Date(coupon.valid_until).getTime() < Date.now()); return <article className="coupon-admin-card" key={coupon.id}><div className="coupon-amount"><strong>{money(coupon.amount_cents)}</strong><small>满 {money(coupon.minimum_cents)} 可用</small></div><div><strong>{coupon.name}</strong><code>{coupon.code}</code><small>{coupon.claimed_quantity} / {coupon.total_quantity || '不限'} 已领取 · {coupon.valid_until ? `至 ${new Date(coupon.valid_until).toLocaleDateString('zh-CN')}` : '长期有效'}</small></div><span className={coupon.is_active && !expired ? 'active-flag' : 'inactive-flag'}>{expired ? '已过期' : coupon.is_active ? '启用' : '停用'}</span><button onClick={() => { setCouponForm({ ...coupon, valid_from: toLocalInput(coupon.valid_from), valid_until: toLocalInput(coupon.valid_until) }); setEditingCouponId(coupon.id) }}>编辑</button></article> })}{!filteredCoupons.length && <Empty text="没有符合条件的优惠券" />}</div>
          </section>
        )}

        {active === 'users' && <TablePanel title="会员账户">
          <QueryToolbar value={queries.users || ''} onChange={(value) => setQueries((current) => ({ ...current, users: value }))} placeholder="搜索会员编号、昵称、手机号或 OpenID" onExport={() => downloadCsv('会员查询结果.csv', [['会员ID', '昵称', '手机号', '微信OpenID', '积分', '注册时间'], ...filteredUsers.map((item) => [item.id, item.nickname, item.phone, item.wechat_openid, item.points, item.created_at])])}><select aria-label="绑定状态" value={userBinding} onChange={(event) => setUserBinding(event.target.value as typeof userBinding)}><option value="all">全部会员</option><option value="phone">已绑手机</option><option value="wechat">已绑微信</option><option value="unbound">未绑定</option></select></QueryToolbar>
          <div className="data-head user-row"><span>会员</span><span>手机号</span><span>微信绑定</span><span>积分</span><span>注册时间</span><span>操作</span></div>
          {filteredUsers.map((item) => <div className="data-row user-row" key={item.id}><div className="user-identity"><span className="swatch" style={{ background: item.avatar_color }} /><div><strong>{item.nickname}</strong><small>会员 #{item.id}</small></div></div><span>{item.phone || '未绑定'}</span><span className={item.wechat_openid ? 'bound-value' : 'muted-value'}>{item.wechat_openid ? '已绑定' : '未绑定'}</span><strong>{item.points}</strong><span>{new Date(item.created_at).toLocaleDateString('zh-CN')}</span><button className="row-action" onClick={() => adjustUserPoints(item).catch((error) => setMessage(error.message))}>调整积分</button></div>)}
          {!filteredUsers.length && <Empty text="没有符合条件的会员" />}
        </TablePanel>}
        {active === 'pets' && <TablePanel title="宠物成长档案">
          <QueryToolbar value={queries.pets || ''} onChange={(value) => setQueries((current) => ({ ...current, pets: value }))} placeholder="搜索会员、手机号、宠物名或权益" />
          <div className="data-head pet-row"><span>所属会员</span><span>宠物</span><span>等级 / 经验</span><span>心情</span><span>饱腹</span><span>当前权益</span></div>
          {filteredPets.map((item) => { const owner = users.find((user) => user.id === item.user_id); return <div className="data-row pet-row" key={item.id}><div><strong>{owner?.nickname || `会员 #${item.user_id}`}</strong><small>{owner?.phone || '未绑定手机'}</small></div><strong>{item.name}</strong><div><strong>Lv{item.level}</strong><small>{item.exp} / {item.next_level_exp}</small></div><span>{item.mood}</span><span>{item.hunger}</span><span>{item.reward}</span></div> })}
          {!filteredPets.length && <Empty text="没有符合条件的宠物记录" />}
        </TablePanel>}

        {active === 'assets' && (
          <TablePanel title="素材库">
            <div className="asset-actions"><label className="upload">上传图片或 GLB/GLTF<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,.glb,.gltf" onChange={(event) => uploadAsset(event).catch((error) => setMessage(error.message))} /></label><span>支持 JPG、PNG、WebP、GIF、GLB、GLTF，单文件不超过 15MB</span></div>
            <QueryToolbar value={queries.assets || ''} onChange={(value) => setQueries((current) => ({ ...current, assets: value }))} placeholder="搜索文件名、类型或编号"><select aria-label="素材类型" value={assetType} onChange={(event) => setAssetType(event.target.value as typeof assetType)}><option value="all">全部素材</option><option value="image">图片</option><option value="model">模型</option></select></QueryToolbar>
            {filteredAssets.map((item) => <div className="row" key={item.id}><div><strong>{item.original_name}</strong><small>{item.asset_type === 'image' ? '图片' : '3D 模型'} · {(item.size / 1024).toFixed(1)}KB · {new Date(item.created_at).toLocaleString('zh-CN')}</small></div><a href={item.url} target="_blank" rel="noreferrer">预览</a><button className="danger-action" onClick={() => removeAsset(item).catch((error) => setMessage(error.message))}>删除</button></div>)}
            {!filteredAssets.length && <Empty text="没有符合条件的素材" />}
          </TablePanel>
        )}

        {active === 'settings' && (
          <TablePanel title="系统配置">
            <div className="security-callout">支付私钥、APIv3 密钥和登录密钥不会在此页面读取或保存，请通过部署环境的 secret 管理。</div>
            <QueryToolbar value={queries.settings || ''} onChange={(value) => setQueries((current) => ({ ...current, settings: value }))} placeholder="搜索配置名称、键名、分组或内容"><select aria-label="配置分组" value={settingGroup} onChange={(event) => setSettingGroup(event.target.value)}><option value="all">全部分组</option>{settingGroups.map((group) => <option key={group} value={group}>{group}</option>)}</select></QueryToolbar>
            {filteredSettings.map((item) => <div className="row setting-row" key={item.key}><div><strong>{item.label || item.key}</strong><small>{item.group} · {item.key}</small></div><input defaultValue={item.value} onBlur={(e) => saveSetting(item, e.target.value).then(() => setMessage('配置已保存')).catch((error) => setMessage(error.message))} /></div>)}
            {!filteredSettings.length && <Empty text="没有符合条件的配置" />}
          </TablePanel>
        )}

        {active === 'admins' && (
          <section className="split">
            <form className="panel form" onSubmit={(event) => createAdmin(event).catch((error) => setMessage(error.message))}>
              <h3>新建管理员</h3>
              <label>邮箱<input required type="email" value={adminForm.email} onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })} /></label>
              <label>姓名<input required value={adminForm.name} onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })} /></label>
              <label>密码<input required minLength={8} type="password" value={adminForm.password} onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })} /></label>
              <label>角色<select value={adminForm.role} onChange={(e) => setAdminForm({ ...adminForm, role: e.target.value as AdminUser['role'] })}><option value="admin">管理员</option><option value="super_admin">超级管理员</option></select></label>
              <button className="primary">创建账号</button>
            </form>
            <TablePanel title="管理员账户"><QueryToolbar value={queries.admins || ''} onChange={(value) => setQueries((current) => ({ ...current, admins: value }))} placeholder="搜索姓名、邮箱、角色或编号"><select aria-label="管理员状态" value={adminStatus} onChange={(event) => setAdminStatus(event.target.value as typeof adminStatus)}><option value="all">全部状态</option><option value="active">已启用</option><option value="inactive">已停用</option></select></QueryToolbar>{filteredAdmins.map((item) => <div className="row" key={item.id}><span className={`status-dot ${item.is_active ? 'active' : ''}`} /><div><strong>{item.name}{item.id === admin.id ? '（当前账号）' : ''}</strong><small>{item.email} · {item.role === 'super_admin' ? '超级管理员' : '管理员'} · 最近登录 {item.last_login_at ? new Date(item.last_login_at).toLocaleString('zh-CN') : '从未'}</small></div><button onClick={() => toggleAdminAccount(item).catch((error) => setMessage(error.message))}>{item.is_active ? '停用' : '启用'}</button></div>)}{!filteredAdmins.length && <Empty text="没有符合条件的管理员" />}</TablePanel>
          </section>
        )}

        {active === 'audit' && <TablePanel title="审计日志"><QueryToolbar value={queries.audit || ''} onChange={(value) => setQueries((current) => ({ ...current, audit: value }))} placeholder="搜索操作、对象、编号、管理员或详情" onExport={() => downloadCsv('审计日志.csv', [['时间', '管理员ID', '操作', '对象', '对象ID', '详情'], ...filteredAudit.map((item) => [item.created_at, item.admin_id, item.action, item.entity, item.entity_id, item.detail])])} />{filteredAudit.map((item) => <div className="row audit-row" key={item.id}><code>{item.action}</code><div><strong>{item.entity} {item.entity_id && `#${item.entity_id}`}</strong><small>{item.detail || '无补充说明'}</small></div><span>管理员 #{item.admin_id || '系统'}</span><time>{new Date(item.created_at).toLocaleString('zh-CN')}</time></div>)}{!filteredAudit.length && <Empty text="没有符合条件的审计记录" />}</TablePanel>}
        </div>
      </section>
    </main>
  )
}

function TablePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel table-panel"><h3>{title}</h3>{children}</section>
}

function PanelTitle({ eyebrow, title, count }: { eyebrow: string; title: string; count: string }) {
  return <div className="panel-heading"><div><p>{eyebrow}</p><h3>{title}</h3></div><span>{count}</span></div>
}

function FormHeading({ title, editing, onCancel }: { title: string; editing: boolean; onCancel: () => void }) {
  return <div className="form-heading"><h3>{title}</h3>{editing && <button type="button" onClick={onCancel}>取消编辑</button>}</div>
}

function QueryToolbar({ value, onChange, placeholder, children, onExport }: { value: string; onChange: (value: string) => void; placeholder: string; children?: React.ReactNode; onExport?: () => void }) {
  return <div className="query-toolbar"><input aria-label={placeholder} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /><div className="query-filters">{children}{onExport && <button type="button" className="tool-action" onClick={onExport}>导出结果</button>}</div></div>
}

function Empty({ text }: { text: string }) {
  return <div className="empty-state"><span>◇</span><p>{text}</p></div>
}
