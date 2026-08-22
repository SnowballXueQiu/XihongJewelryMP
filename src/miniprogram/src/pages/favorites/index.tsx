import { useState } from 'react'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import ProductCard from '@/components/ProductCard'
import LuxuryLoader from '@/components/LuxuryLoader'
import IconFont from '@/components/IconFont'
import { fetchFavorites, toggleFavorite } from '@/services/api'
import { Favorite } from '@/types/domain'
import './index.scss'

export default function FavoritesPage() {
  const [items, setItems] = useState<Favorite[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    try { setItems(await fetchFavorites()) } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '收藏加载失败', icon: 'none' })
    } finally { setLoading(false); Taro.stopPullDownRefresh() }
  }
  useDidShow(() => { load() })
  usePullDownRefresh(load)

  async function remove(productId: number) {
    try {
      await toggleFavorite(productId)
      setItems((current) => current.filter((item) => item.product.id !== productId))
      Taro.showToast({ title: '已移出收藏', icon: 'none' })
    } catch (error) { Taro.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' }) }
  }

  return <View className='favorites-page'>
    <View className='favorites-head'><Text>MY SELECTION</Text><Text>心选收藏</Text><Text>把心动留在这里，慢慢选择。</Text></View>
    {loading ? <LuxuryLoader label='正在读取心选作品' /> : items.length ? (
      <View className='favorites-grid'>{items.map((item, index) => <ProductCard key={item.id} product={item.product} index={index} favorite onFavorite={() => remove(item.product.id)} />)}</View>
    ) : <View className='favorite-empty'><View className='heart-line'><IconFont name='heart' /></View><Text>尚未收藏作品</Text><Text>遇见喜欢的珠宝时，轻触心形即可保存</Text><Button onClick={() => Taro.switchTab({ url: '/pages/products/index' })}>浏览作品</Button></View>}
  </View>
}
