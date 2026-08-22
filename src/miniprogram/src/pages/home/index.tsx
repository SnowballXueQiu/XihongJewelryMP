import { useCallback, useEffect, useState } from 'react'
import Taro, { usePullDownRefresh } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import ProductCard from '@/components/ProductCard'
import IconFont from '@/components/IconFont'
import LuxuryLoader from '@/components/LuxuryLoader'
import { fetchBanners, fetchProducts } from '@/services/api'
import { usePageEntranceAnimation } from '@/hooks/useSubtleAnimation'
import { Banner, Product } from '@/types/domain'
import './index.scss'

const categories = [
  { name: '戒指', en: 'RINGS', slug: 'rings', mark: '01' },
  { name: '手链', en: 'BRACELETS', slug: 'bracelets', mark: '02' },
  { name: '项链', en: 'NECKLACES', slug: 'necklaces', mark: '03' },
  { name: '耳饰', en: 'EARRINGS', slug: 'earrings', mark: '04' }
]

export default function HomePage() {
  const [featured, setFeatured] = useState<Product[]>([])
  const [newest, setNewest] = useState<Product | null>(null)
  const [hero, setHero] = useState<Banner | null>(null)
  const [loading, setLoading] = useState(true)
  const pageAnimation = usePageEntranceAnimation()

  const load = useCallback(async () => {
    setLoading(true)
    const [featuredItems, newestItems, banners] = await Promise.all([
      fetchProducts({ featured: true, sort: 'recommended' }),
      fetchProducts({ sort: 'newest' }),
      fetchBanners('home_hero')
    ])
    setFeatured(featuredItems.slice(0, 4))
    setNewest(newestItems[0] || null)
    setHero(banners[0] || null)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  usePullDownRefresh(() => {
    load().finally(() => Taro.stopPullDownRefresh())
  })

  function openCategory(slug: string) {
    Taro.setStorageSync('catalog_category', slug)
    Taro.switchTab({ url: '/pages/products/index' })
  }

  return (
    <View className='page home-page' animation={pageAnimation}>
      <View className='home-masthead'>
        <View>
          <Text className='masthead-eyebrow'>XIHONG · TIANJIN</Text>
          <Text className='masthead-name'>玺鸿珠宝</Text>
        </View>
        <Button className='masthead-cart' hoverClass='round-press' onClick={() => Taro.switchTab({ url: '/pages/cart/index' })}>
          <IconFont name='cart' />购物袋
        </Button>
      </View>

      <View className='editorial-hero' style={{ backgroundColor: hero?.image_color || '#55272c' }}>
        <View className='hero-noise' />
        <View className='hero-copy'>
          <Text className='hero-index'>ISSUE / 01</Text>
          <Text className='hero-title'>{hero?.title || '珠宝，成为日常的标点'}</Text>
          <Text className='hero-subtitle'>{hero?.subtitle || '克制的线条、温润的材质，以及只属于你的光。'}</Text>
          <Button className='hero-action' hoverClass='hero-action-press' onClick={() => Taro.switchTab({ url: '/pages/products/index' })}>
            浏览本季精选 <IconFont name='chevronRight' className='hero-arrow' />
          </Button>
        </View>
        <View className='hero-object'>
          <View className='hero-ring ring-back' />
          <View className='hero-ring ring-front' />
          <View className='hero-jewel' />
          <Text className='hero-seal'>XH</Text>
        </View>
      </View>

      <View className='service-ribbon'>
        <Text>顺丰保价</Text><Text className='ribbon-dot'>◆</Text>
        <Text>七日无理由</Text><Text className='ribbon-dot'>◆</Text>
        <Text>终身保养</Text>
      </View>

      <View className='section-heading'>
        <View>
          <Text className='section-kicker'>SHOP BY FORM</Text>
          <Text className='section-title'>按形制探索</Text>
        </View>
        <Text className='section-counter'>01 — 04</Text>
      </View>

      <View className='category-editorial'>
        {categories.map((item, index) => (
          <Button
            key={item.slug}
            className={`category-line category-line-${index + 1}`}
            hoverClass='category-line-press'
            onClick={() => openCategory(item.slug)}
          >
            <Text className='category-number'>{item.mark}</Text>
            <View className='category-copy'>
              <Text className='category-name'>{item.name}</Text>
              <Text className='category-en'>{item.en}</Text>
            </View>
            <IconFont name='chevronRight' className='category-arrow' />
          </Button>
        ))}
      </View>

      <View className='section-heading featured-heading'>
        <View>
          <Text className='section-kicker'>CURATOR&apos;S EDIT</Text>
          <Text className='section-title'>主理人精选</Text>
        </View>
        <Button className='text-link' onClick={() => Taro.switchTab({ url: '/pages/products/index' })}>查看全部</Button>
      </View>

      {loading ? (
        <LuxuryLoader compact label='正在甄选本季作品' />
      ) : (
        <View className='home-product-grid'>
          {featured.map((product, index) => <ProductCard key={product.id} product={product} index={index} />)}
        </View>
      )}

      {newest && (
        <View className='new-arrival' onClick={() => Taro.navigateTo({ url: `/pages/product-detail/index?id=${newest.id}` })}>
          <View className='arrival-copy'>
            <Text className='arrival-kicker'>NEW ARRIVAL</Text>
            <Text className='arrival-title'>{newest.name}</Text>
            <Text className='arrival-subtitle'>{newest.description}</Text>
            <View className='arrival-link'><Text>阅读珠宝故事</Text><IconFont name='chevronRight' /></View>
          </View>
          <View className='arrival-medallion' style={{ backgroundColor: newest.image_color }}>
            <View className='medallion-ring' />
            <View className='medallion-gem' />
          </View>
        </View>
      )}

      <View className='member-story'>
        <Text className='member-kicker'>XIHONG CLUB</Text>
        <Text className='member-title'>让每一次心动，都有回响</Text>
        <Text className='member-copy'>收藏、签到与购买都会积累成长值，解锁保养、包邮与生日礼遇。</Text>
        <Button className='member-action' hoverClass='button-press' onClick={() => Taro.switchTab({ url: '/pages/profile/index' })}>进入会员花园</Button>
      </View>
    </View>
  )
}
