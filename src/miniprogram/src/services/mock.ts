import { Category, Pet, Product, User } from '@/types/domain'

export const mockCategories: Category[] = [
  { id: 1, name: '全部', slug: 'all', sort_order: 0 },
  { id: 2, name: '戒指', slug: 'rings', sort_order: 1 },
  { id: 3, name: '手链手环', slug: 'bracelets', sort_order: 2 },
  { id: 4, name: '项链', slug: 'necklaces', sort_order: 3 },
  { id: 5, name: '耳饰', slug: 'earrings', sort_order: 4 }
]

export const mockProducts: Product[] = [
  {
    id: 1,
    name: '红宝石叠戴戒指',
    subtitle: '18K 金 / 红宝石',
    description: '适合日常叠戴的轻珠宝戒指，预留 AR 手部试戴参数。',
    category_slug: 'rings',
    material: '18K金',
    price_cents: 268000,
    stock: 12,
    image_color: '#B98B85',
    supports_ar: true,
    ar_model_url: 'https://mmbizwxaminiprogram-1258344707.cos.ap-guangzhou.myqcloud.com/xr-frame/demo/cool-star.glb',
    ar_scale: '0.12 0.12 0.12',
    ar_rotation: '0 0 0',
    ar_position: '0 0.05 0',
    ar_auto_sync: 9
  },
  {
    id: 2,
    name: '月光珍珠手链',
    subtitle: '淡水珍珠 / 银镀金',
    description: '柔和珍珠光泽，支持后续替换手腕试戴模型。',
    category_slug: 'bracelets',
    material: '珍珠',
    price_cents: 98000,
    stock: 24,
    image_color: '#E6D8BF',
    supports_ar: true,
    ar_model_url: 'https://mmbizwxaminiprogram-1258344707.cos.ap-guangzhou.myqcloud.com/xr-frame/demo/cool-star.glb',
    ar_scale: '0.18 0.18 0.18',
    ar_rotation: '0 0 0',
    ar_position: '0 0.08 0',
    ar_auto_sync: 5
  },
  {
    id: 3,
    name: '鎏金细链项链',
    subtitle: '14K 包金',
    description: '通勤款细链，MVP 阶段仅展示商品详情。',
    category_slug: 'necklaces',
    material: '包金',
    price_cents: 76000,
    stock: 18,
    image_color: '#C7AD76',
    supports_ar: false,
    ar_scale: '0.2 0.2 0.2',
    ar_rotation: '0 0 0',
    ar_position: '0 0 0',
    ar_auto_sync: 9
  },
  {
    id: 4,
    name: '星砂耳钉',
    subtitle: '925 银 / 锆石',
    description: '低敏耳钉，适合作为会员等级礼。',
    category_slug: 'earrings',
    material: '银',
    price_cents: 42000,
    stock: 36,
    image_color: '#B8B4AA',
    supports_ar: false,
    ar_scale: '0.2 0.2 0.2',
    ar_rotation: '0 0 0',
    ar_position: '0 0 0',
    ar_auto_sync: 9
  }
]

export const mockUser: User = {
  id: 1,
  nickname: '玺鸿会员',
  phone: '13800000000',
  avatar_color: '#B89A63',
  points: 120
}

export const mockPet: Pet = {
  name: '玺宝',
  level: 2,
  exp: 120,
  mood: 78,
  hunger: 28,
  next_level_exp: 300,
  reward: '会员包邮券',
  asset_key: 'gem-pet-v1'
}
