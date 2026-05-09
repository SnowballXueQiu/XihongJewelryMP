import { useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, Button } from '@tarojs/components'
import { fetchBanners, fetchProducts, formatMoney } from '@/services/api'
import { usePageEntranceAnimation } from '@/hooks/useSubtleAnimation'
import { Banner, Product } from '@/types/domain'
import './index.scss'

export default function HomePage() {
  const [featured, setFeatured] = useState<Product[]>([])
  const [hero, setHero] = useState<Banner | null>(null)
  const pageAnimation = usePageEntranceAnimation()

  useEffect(() => {
    fetchProducts({ arOnly: true }).then((items) => setFeatured(items.slice(0, 2)))
    fetchBanners('home_hero').then((items) => setHero(items[0] || null))
  }, [])

  return (
    <View className='page home-page' animation={pageAnimation}>
      <View className='hero' style={{ background: hero?.image_color || '#111111' }}>
        <View className='hero-copy'>
          <Text className='hero-title'>{hero?.title || '玺鸿珠宝'}</Text>
          <Text className='hero-subtitle'>{hero?.subtitle || '为戒指、手链与日常轻珠宝打造可试戴的线上门店。'}</Text>
          <Button className='primary-btn hero-btn' onClick={() => Taro.switchTab({ url: '/pages/products/index' })}>选购珠宝</Button>
        </View>
        <View className='hero-gem'>
          <View className='gem-core' />
        </View>
      </View>

      <View className='promo-row'>
        <View className='promo-card'>
          <Text className='promo-title'>AR 试戴</Text>
          <Text className='promo-desc'>支持手部追踪，模型参数已预留。</Text>
        </View>
        <View className='promo-card dark'>
          <Text className='promo-title'>会员宠物</Text>
          <Text className='promo-desc'>互动成长，兑换真实权益。</Text>
        </View>
      </View>

      <Text className='section-title'>热门分类</Text>
      <View className='category-grid'>
        {[
          ['戒指', 'rings'],
          ['手链手环', 'bracelets'],
          ['项链', 'necklaces'],
          ['耳饰', 'earrings']
        ].map(([name, slug]) => (
          <Button
            key={slug}
            className='category-tile'
            hoverClass='button-press'
            onClick={() => Taro.switchTab({ url: '/pages/products/index' })}
          >
            {name}
          </Button>
        ))}
      </View>

      <Text className='section-title'>推荐试戴</Text>
      <View className='featured-list'>
        {featured.map((product) => (
          <View key={product.id} className='featured-card card pressable' hoverClass='button-press' onClick={() => Taro.navigateTo({ url: `/pages/product-detail/index?id=${product.id}` })}>
            <View className='product-swatch' style={{ background: product.image_color }} />
            <View className='featured-info'>
              <Text className='featured-name'>{product.name}</Text>
              <Text className='featured-subtitle'>{product.subtitle}</Text>
              <Text className='featured-price'>{formatMoney(product.price_cents)}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}
