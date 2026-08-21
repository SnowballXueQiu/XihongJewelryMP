'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000'

type AdminUser = {
  id: number
  email: string
  name: string
  role: 'super_admin' | 'admin'
  is_active: boolean
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
}

type Pet = {
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
  original_name: string
  content_type: string
  url: string
  size: number
  asset_type: string
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
  return `¥${(cents / 100).toFixed(0)}`
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
  const [email, setEmail] = useState('admin@xihong.local')
  const [password, setPassword] = useState('XihongAdmin123!')
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
  const [logisticsDraft, setLogisticsDraft] = useState<Record<number, { company: string; tracking: string }>>({})
  const [busy, setBusy] = useState(false)
  const [adminForm, setAdminForm] = useState({ email: '', name: '', password: '', role: 'admin' as 'super_admin' | 'admin', is_active: true })

  const filteredOrders = useMemo(() => orders.filter((order) => {
    const statusMatch = orderFilter === 'all' || order.status === orderFilter
    const query = orderSearch.trim().toLowerCase()
    const queryMatch = !query || [String(order.id), order.order_no, order.receiver_name, order.receiver_phone, order.tracking_no].some((value) => value?.toLowerCase().includes(query))
    return statusMatch && queryMatch
  }), [orderFilter, orderSearch, orders])
  const orderPageCount = Math.max(1, Math.ceil(filteredOrders.length / 8))
  const visibleOrders = useMemo(() => filteredOrders.slice((orderPage - 1) * 8, orderPage * 8), [filteredOrders, orderPage])
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

  useEffect(() => { setOrderPage(1) }, [orderFilter, orderSearch])
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
  }

  async function saveBanner(event: FormEvent) {
    event.preventDefault()
    const path = editingBannerId ? `/api/admin/banners/${editingBannerId}` : '/api/admin/banners'
    const method = editingBannerId ? 'PUT' : 'POST'
    const saved = await api<Banner>(path, { method, body: JSON.stringify(bannerForm) })
    setBanners((items) => editingBannerId ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved])
    setBannerForm(emptyBanner)
    setEditingBannerId(null)
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
            <form className="panel form" onSubmit={saveProduct}>
              <h3>{editingProductId ? '编辑商品' : '新增商品'}</h3>
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
              <h3>商品列表</h3>
              {products.map((item) => (
                <div className="row" key={item.id}>
                  <span className="swatch" style={{ background: item.image_color }} />
                  <div><strong>{item.name}</strong><small>{item.category_slug} · {item.material} · 库存 {item.stock} · 已售 {item.sales}{item.free_shipping ? ' · 单品包邮' : ''}</small></div>
                  <b>{money(item.price_cents)}</b>
                  <button onClick={() => { setProductForm({ ...item }); setEditingProductId(item.id) }}>编辑</button>
                  <button onClick={() => removeProduct(item.id)}>删除</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {active === 'categories' && (
          <section className="split">
            <form className="panel form" onSubmit={saveCategory}>
              <h3>{editingCategoryId ? '编辑分类' : '新增分类'}</h3>
              <label>名称<input value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} /></label>
              <label>Slug<input value={categoryForm.slug} onChange={(e) => setCategoryForm({ ...categoryForm, slug: e.target.value })} /></label>
              <label>排序<input type="number" value={categoryForm.sort_order} onChange={(e) => setCategoryForm({ ...categoryForm, sort_order: Number(e.target.value) })} /></label>
              <label className="check"><input type="checkbox" checked={categoryForm.is_active} onChange={(e) => setCategoryForm({ ...categoryForm, is_active: e.target.checked })} /> 启用</label>
              <button className="primary">保存分类</button>
            </form>
            <ListPanel title="分类列表" items={categories.map((item) => ({ id: item.id, title: item.name, meta: `${item.slug} · 排序 ${item.sort_order}`, action: () => { setCategoryForm(item); setEditingCategoryId(item.id) } }))} />
          </section>
        )}

        {active === 'banners' && (
          <section className="split">
            <form className="panel form" onSubmit={saveBanner}>
              <h3>{editingBannerId ? '编辑轮播' : '新增轮播'}</h3>
              <label>标题<input value={bannerForm.title} onChange={(e) => setBannerForm({ ...bannerForm, title: e.target.value })} /></label>
              <label>副标题<input value={bannerForm.subtitle} onChange={(e) => setBannerForm({ ...bannerForm, subtitle: e.target.value })} /></label>
              <label>图片 URL<input value={bannerForm.image_url} onChange={(e) => setBannerForm({ ...bannerForm, image_url: e.target.value })} /></label>
              <label>色块<input value={bannerForm.image_color} onChange={(e) => setBannerForm({ ...bannerForm, image_color: e.target.value })} /></label>
              <label>位置<input value={bannerForm.placement} onChange={(e) => setBannerForm({ ...bannerForm, placement: e.target.value })} /></label>
              <label>跳转值<input value={bannerForm.link_value} onChange={(e) => setBannerForm({ ...bannerForm, link_value: e.target.value })} /></label>
              <button className="primary">保存轮播</button>
            </form>
            <ListPanel title="轮播列表" items={banners.map((item) => ({ id: item.id, title: item.title, meta: `${item.placement} · ${item.is_active ? '启用' : '停用'}`, color: item.image_color, action: () => { setBannerForm(item); setEditingBannerId(item.id) } }))} />
          </section>
        )}

        {active === 'orders' && (
          <section className="panel order-manager">
            <div className="panel-heading"><div><p>FULFILLMENT DESK</p><h3>订单履约</h3></div><span>{filteredOrders.length} / {orders.length} 笔</span></div>
            <div className="table-tools"><input value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} placeholder="搜索订单号、收件人、手机或运单号" /><select value={orderFilter} onChange={(event) => setOrderFilter(event.target.value as typeof orderFilter)}><option value="all">全部状态</option>{Object.entries(orderStatusText).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
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
            <div className="data-head payment-row"><span>商户订单号</span><span>关联订单</span><span>微信交易号 / 失败原因</span><span>更新时间</span><span>状态</span></div>
            {payments.map((payment) => <div className="data-row payment-row" key={payment.id}><code>{payment.out_trade_no || '—'}</code><button className="link-button" onClick={() => { setOrderSearch(String(payment.order_id)); setActive('orders') }}>#{payment.order_id}</button><div><strong>{payment.transaction_id || '尚无微信交易号'}</strong>{payment.failure_reason && <small>{payment.failure_reason}</small>}</div><span>{payment.updated_at ? new Date(payment.updated_at).toLocaleString('zh-CN') : '—'}</span><span className={`status-pill payment-${payment.status}`}>{paymentStatusText[payment.status]}</span></div>)}
            {!payments.length && <Empty text="暂无支付流水；用户发起支付后会自动出现" />}
          </TablePanel><TablePanel title="退款记录"><div className="data-head refund-row"><span>退款单号</span><span>订单</span><span>金额 / 原因</span><span>更新时间</span><span>状态</span></div>{refunds.map((refund) => <div className="data-row refund-row" key={refund.id}><code>{refund.out_refund_no}</code><button className="link-button" onClick={() => { setOrderSearch(String(refund.order_id)); setActive('orders') }}>#{refund.order_id}</button><div><strong>{money(refund.amount_cents)}</strong><small>{refund.reason}</small></div><span>{new Date(refund.updated_at).toLocaleString('zh-CN')}</span><span className={`status-pill refund-${refund.status}`}>{refundStatusText[refund.status] || refund.status}</span></div>)}{!refunds.length && <Empty text="暂无退款记录" />}</TablePanel></div>
        )}

        {active === 'coupons' && (
          <section className="split coupon-admin">
            <form className="panel form" onSubmit={(event) => saveCoupon(event).catch((error) => setMessage(error.message))}>
              <h3>{editingCouponId ? '编辑优惠券' : '创建优惠券'}</h3>
              <div className="two"><label>券码<input required maxLength={32} value={couponForm.code} onChange={(event) => setCouponForm({ ...couponForm, code: event.target.value.toUpperCase() })} placeholder="WELCOME88" /></label><label>名称<input required value={couponForm.name} onChange={(event) => setCouponForm({ ...couponForm, name: event.target.value })} /></label></div>
              <label>使用说明<textarea value={couponForm.description} onChange={(event) => setCouponForm({ ...couponForm, description: event.target.value })} /></label>
              <div className="two"><label>优惠金额（元）<input required type="number" min="0.01" step="0.01" value={couponForm.amount_cents / 100} onChange={(event) => setCouponForm({ ...couponForm, amount_cents: cents(event.target.value) })} /></label><label>最低消费（元）<input type="number" min="0" value={couponForm.minimum_cents / 100} onChange={(event) => setCouponForm({ ...couponForm, minimum_cents: cents(event.target.value) })} /></label></div>
              <label>发行数量（0 表示不限）<input type="number" min="0" value={couponForm.total_quantity} onChange={(event) => setCouponForm({ ...couponForm, total_quantity: Number(event.target.value) })} /></label>
              <div className="two"><label>开始时间<input required type="datetime-local" value={couponForm.valid_from} onChange={(event) => setCouponForm({ ...couponForm, valid_from: event.target.value })} /></label><label>结束时间<input type="datetime-local" value={couponForm.valid_until || ''} onChange={(event) => setCouponForm({ ...couponForm, valid_until: event.target.value })} /></label></div>
              <label className="check"><input type="checkbox" checked={couponForm.is_active} onChange={(event) => setCouponForm({ ...couponForm, is_active: event.target.checked })} /> 立即启用</label>
              <button className="primary" type="submit">保存优惠券</button>
            </form>
            <div className="panel coupon-list-admin"><div className="panel-heading"><div><p>MEMBER BENEFITS</p><h3>优惠券列表</h3></div><span>{coupons.length} 张</span></div>{coupons.map((coupon) => <article className="coupon-admin-card" key={coupon.id}><div className="coupon-amount"><strong>{money(coupon.amount_cents)}</strong><small>满 {money(coupon.minimum_cents)} 可用</small></div><div><strong>{coupon.name}</strong><code>{coupon.code}</code><small>{coupon.claimed_quantity} / {coupon.total_quantity || '不限'} 已领取 · {coupon.valid_until ? `至 ${new Date(coupon.valid_until).toLocaleDateString('zh-CN')}` : '长期有效'}</small></div><span className={coupon.is_active ? 'active-flag' : 'inactive-flag'}>{coupon.is_active ? '启用' : '停用'}</span><button onClick={() => { setCouponForm({ ...coupon, valid_from: toLocalInput(coupon.valid_from), valid_until: toLocalInput(coupon.valid_until) }); setEditingCouponId(coupon.id) }}>编辑</button></article>)}{!coupons.length && <Empty text="暂无优惠券" />}</div>
          </section>
        )}

        {active === 'users' && <ListPanel title="用户管理" items={users.map((item) => ({ id: item.id, title: item.nickname, meta: `积分 ${item.points} · ${item.phone || '未填手机号'}`, color: item.avatar_color }))} />}
        {active === 'pets' && <ListPanel title="宠物积分" items={pets.map((item, index) => ({ id: index, title: `${item.name} · Lv${item.level}`, meta: `经验 ${item.exp}/${item.next_level_exp} · ${item.reward}` }))} />}

        {active === 'assets' && (
          <TablePanel title="素材库">
            <label className="upload">上传图片或 GLB/GLTF<input type="file" onChange={uploadAsset} /></label>
            {assets.map((item) => <div className="row" key={item.id}><div><strong>{item.original_name}</strong><small>{item.asset_type} · {(item.size / 1024).toFixed(1)}KB</small></div><a href={item.url} target="_blank">打开</a></div>)}
          </TablePanel>
        )}

        {active === 'settings' && (
          <TablePanel title="系统配置">
            <div className="security-callout">支付私钥、APIv3 密钥和登录密钥不会在此页面读取或保存，请通过部署环境的 secret 管理。</div>
            {settings.map((item) => <div className="row setting-row" key={item.key}><div><strong>{item.label || item.key}</strong><small>{item.group} · {item.key}</small></div><input defaultValue={item.value} onBlur={(e) => saveSetting(item, e.target.value)} /></div>)}
          </TablePanel>
        )}

        {active === 'admins' && (
          <section className="split">
            <form className="panel form" onSubmit={createAdmin}>
              <h3>新建管理员</h3>
              <label>邮箱<input value={adminForm.email} onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })} /></label>
              <label>姓名<input value={adminForm.name} onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })} /></label>
              <label>密码<input type="password" value={adminForm.password} onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })} /></label>
              <label>角色<select value={adminForm.role} onChange={(e) => setAdminForm({ ...adminForm, role: e.target.value as AdminUser['role'] })}><option value="admin">管理员</option><option value="super_admin">超级管理员</option></select></label>
              <button className="primary">创建账号</button>
            </form>
            <ListPanel title="管理员账户" items={admins.map((item) => ({ id: item.id, title: item.name, meta: `${item.email} · ${item.role} · ${item.is_active ? '启用' : '停用'}` }))} />
          </section>
        )}

        {active === 'audit' && <ListPanel title="审计日志" items={audit.map((item) => ({ id: item.id, title: `${item.action} ${item.entity}`, meta: `${item.detail || item.entity_id} · ${new Date(item.created_at).toLocaleString()}` }))} />}
        </div>
      </section>
    </main>
  )
}

function TablePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel table-panel"><h3>{title}</h3>{children}</section>
}

function Empty({ text }: { text: string }) {
  return <div className="empty-state"><span>◇</span><p>{text}</p></div>
}

function ListPanel({ title, items }: { title: string; items: Array<{ id: number; title: string; meta: string; color?: string; action?: () => void }> }) {
  return (
    <TablePanel title={title}>
      {items.map((item) => (
        <div className="row" key={item.id}>
          {item.color && <span className="swatch" style={{ background: item.color }} />}
          <div><strong>{item.title}</strong><small>{item.meta}</small></div>
          {item.action && <button onClick={item.action}>编辑</button>}
        </div>
      ))}
    </TablePanel>
  )
}
