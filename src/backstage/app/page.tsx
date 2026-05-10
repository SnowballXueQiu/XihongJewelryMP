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
  stock: number
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
  status: 'pending_payment' | 'paid' | 'cancelled' | 'failed'
  total_cents: number
  receiver_name: string
  receiver_phone: string
  receiver_address: string
  items: Array<{ product_id: number; product_name: string; unit_price_cents: number; quantity: number }>
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

type ModuleKey = 'dashboard' | 'products' | 'categories' | 'banners' | 'orders' | 'users' | 'pets' | 'assets' | 'settings' | 'admins' | 'audit'

const modules: Array<{ key: ModuleKey; label: string; description: string }> = [
  { key: 'dashboard', label: '总览', description: '店铺运营、订单与内容配置概览' },
  { key: 'products', label: '商品', description: '维护商品资料、库存、价格与 AR 参数' },
  { key: 'categories', label: '分类', description: '维护小程序商品分类与排序' },
  { key: 'banners', label: '轮播', description: '配置首页主视觉、宣传位与跳转' },
  { key: 'orders', label: '订单', description: '查看订单并调整支付状态' },
  { key: 'users', label: '用户', description: '查看会员资料、积分和微信绑定状态' },
  { key: 'pets', label: '宠物积分', description: '查看会员宠物等级、经验与权益' },
  { key: 'assets', label: '素材', description: '上传商品图、轮播图和 AR 模型文件' },
  { key: 'settings', label: '配置', description: '维护门店、微信和支付基础配置' },
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
  stock: 0,
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

export default function BackstagePage() {
  const [token, setToken] = useState('')
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [active, setActive] = useState<ModuleKey>('dashboard')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('admin@xihong.local')
  const [password, setPassword] = useState('XihongAdmin123!')
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [banners, setBanners] = useState<Banner[]>([])
  const [orders, setOrders] = useState<Order[]>([])
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
  const [adminForm, setAdminForm] = useState({ email: '', name: '', password: '', role: 'admin' as 'super_admin' | 'admin', is_active: true })

  const stats = useMemo(() => [
    ['商品数', products.length],
    ['上架商品', products.filter((item) => item.status === 'active').length],
    ['待支付订单', orders.filter((item) => item.status === 'pending_payment').length],
    ['会员用户', users.length],
    ['素材文件', assets.length]
  ], [assets.length, orders, products, users.length])
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
    const headers = nextToken ? { Authorization: `Bearer ${nextToken}` } : undefined
    const request = async <T,>(path: string): Promise<T> => {
      const response = await fetch(`${API_BASE}${path}`, { headers })
      if (!response.ok) throw new Error(path)
      return response.json()
    }
    const [me, nextProducts, nextCategories, nextBanners, nextOrders, nextUsers, nextPets, nextAssets, nextSettings, nextAudit] = await Promise.all([
      request<AdminUser>('/api/admin/me'),
      request<Product[]>('/api/admin/products'),
      request<Category[]>('/api/admin/categories'),
      request<Banner[]>('/api/admin/banners'),
      request<Order[]>('/api/admin/orders'),
      request<User[]>('/api/admin/users'),
      request<Pet[]>('/api/admin/pets'),
      request<Asset[]>('/api/admin/assets'),
      request<Setting[]>('/api/admin/settings'),
      request<AuditLog[]>('/api/admin/audit-logs')
    ])
    setAdmin(me)
    setProducts(nextProducts)
    setCategories(nextCategories)
    setBanners(nextBanners)
    setOrders(nextOrders)
    setUsers(nextUsers)
    setPets(nextPets)
    setAssets(nextAssets)
    setSettings(nextSettings)
    setAudit(nextAudit)
    if (me.role === 'super_admin') {
      const nextAdmins = await request<AdminUser[]>('/api/admin/admin-users')
      setAdmins(nextAdmins)
    }
  }

  useEffect(() => {
    const stored = window.localStorage.getItem('xihong_admin_token')
    if (stored) {
      setToken(stored)
      loadAll(stored).catch(() => window.localStorage.removeItem('xihong_admin_token'))
    }
  }, [])

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
    const saved = await api<Order>(`/api/admin/orders/${order.id}/status`, { method: 'PUT', body: JSON.stringify({ status }) })
    setOrders((items) => items.map((item) => item.id === saved.id ? saved : item))
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
            <label>邮箱<input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
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
            <span>{API_BASE}</span>
            <button className="ghost" onClick={() => loadAll()}>刷新数据</button>
          </div>
        </header>
        {message && <p className="message">{message}</p>}

        <div className="content-body" key={active}>
        {active === 'dashboard' && (
          <section className="grid stats">
            {stats.map(([label, value]) => (
              <article key={label} className="panel stat"><span>{label}</span><strong>{value}</strong></article>
            ))}
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
              <div className="two"><label>价格<input type="number" value={productForm.price_cents / 100} onChange={(e) => setProductForm({ ...productForm, price_cents: cents(e.target.value) })} /></label><label>库存<input type="number" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: Number(e.target.value) })} /></label></div>
              <label>状态<select value={productForm.status} onChange={(e) => setProductForm({ ...productForm, status: e.target.value as Product['status'] })}><option value="draft">草稿</option><option value="active">上架</option><option value="inactive">下架</option></select></label>
              <label>封面 URL<input value={productForm.cover_url} onChange={(e) => setProductForm({ ...productForm, cover_url: e.target.value })} /></label>
              <label>AR 模型 URL<input value={productForm.ar_model_url || ''} onChange={(e) => setProductForm({ ...productForm, ar_model_url: e.target.value })} /></label>
              <label className="check"><input type="checkbox" checked={productForm.supports_ar} onChange={(e) => setProductForm({ ...productForm, supports_ar: e.target.checked })} /> 支持 AR 试戴</label>
              <label>详情<textarea value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} /></label>
              <button className="primary" type="submit">保存商品</button>
            </form>
            <div className="panel table-panel">
              <h3>商品列表</h3>
              {products.map((item) => (
                <div className="row" key={item.id}>
                  <span className="swatch" style={{ background: item.image_color }} />
                  <div><strong>{item.name}</strong><small>{item.category_slug} · {item.material} · {item.status}</small></div>
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
          <TablePanel title="订单管理">
            {orders.map((order) => (
              <div className="row" key={order.id}>
                <div><strong>订单 #{order.id}</strong><small>{order.receiver_name} · {order.items.length} 件 · {order.status}</small></div>
                <b>{money(order.total_cents)}</b>
                <select value={order.status} onChange={(e) => updateOrderStatus(order, e.target.value as Order['status'])}><option value="pending_payment">待支付</option><option value="paid">已支付</option><option value="cancelled">已取消</option><option value="failed">失败</option></select>
              </div>
            ))}
          </TablePanel>
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
