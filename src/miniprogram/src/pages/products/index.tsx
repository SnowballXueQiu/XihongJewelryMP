import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { Button, Input, Picker, ScrollView, Switch, Text, View } from '@tarojs/components'
import ProductCard from '@/components/ProductCard'
import IconFont from '@/components/IconFont'
import { fetchCategories, fetchFavorites, fetchProducts, toggleFavorite } from '@/services/api'
import { useContentRefreshAnimation, usePageEntranceAnimation } from '@/hooks/useSubtleAnimation'
import { Category, Product } from '@/types/domain'
import './index.scss'

const materials = ['all', '18K金', '18K白金', '14K金', '足金', '珍珠', '包金', '银']
const materialLabels = ['全部材质', '18K 金', '18K 白金', '14K 金', '足金', '珍珠', '包金', '925 银']
const sortOptions = ['recommended', 'sales', 'newest', 'price_asc', 'price_desc']
const sortLabels = ['精选排序', '销量优先', '上新优先', '价格从低到高', '价格从高到低']

export default function ProductsPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [favoriteIds, setFavoriteIds] = useState<number[]>([])
  const [category, setCategory] = useState('all')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [materialIndex, setMaterialIndex] = useState(0)
  const [sortIndex, setSortIndex] = useState(0)
  const [inStock, setInStock] = useState(false)
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [loading, setLoading] = useState(true)

  const material = useMemo(() => materials[materialIndex], [materialIndex])
  const sort = useMemo(() => sortOptions[sortIndex], [sortIndex])
  const activeFilters = Number(materialIndex > 0) + Number(inStock) + Number(Boolean(minPrice || maxPrice))
  const pageAnimation = usePageEntranceAnimation()
  const productGridAnimation = useContentRefreshAnimation([category, search, material, inStock, minPrice, maxPrice, sort, products.length])

  const loadProducts = useCallback(async () => {
    setLoading(true)
    const result = await fetchProducts({ category, q: search, material, inStock, minPrice, maxPrice, sort })
    setProducts(result)
    setLoading(false)
  }, [category, search, material, inStock, minPrice, maxPrice, sort])

  useEffect(() => {
    fetchCategories().then(setCategories)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), 280)
    return () => clearTimeout(timer)
  }, [q])

  useEffect(() => {
    loadProducts()
  }, [loadProducts])

  useDidShow(() => {
    const pendingCategory = Taro.getStorageSync<string>('catalog_category')
    if (pendingCategory) {
      setCategory(pendingCategory)
      Taro.removeStorageSync('catalog_category')
    }
    fetchFavorites().then((items) => setFavoriteIds(items.map((item) => item.product.id))).catch(() => undefined)
  })

  usePullDownRefresh(() => {
    Promise.all([loadProducts(), fetchFavorites().then((items) => setFavoriteIds(items.map((item) => item.product.id)))])
      .finally(() => Taro.stopPullDownRefresh())
  })

  function resetFilters() {
    setMaterialIndex(0)
    setInStock(false)
    setMinPrice('')
    setMaxPrice('')
  }

  async function favorite(product: Product) {
    try {
      const result = await toggleFavorite(product.id)
      setFavoriteIds((ids) => result.active ? [...new Set([...ids, product.id])] : ids.filter((id) => id !== product.id))
      Taro.showToast({ title: result.active ? '已加入心愿单' : '已取消收藏', icon: 'none' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
    }
  }

  return (
    <View className='page products-page' animation={pageAnimation}>
      <View className='catalog-head'>
        <View><Text className='catalog-eyebrow'>THE COLLECTION</Text><Text className='catalog-title'>臻选珠宝</Text></View>
        <Button className='catalog-bag' hoverClass='round-press' ariaLabel='购物袋' onClick={() => Taro.navigateTo({ url: '/pages/cart/index' })}><IconFont name='cart' /></Button>
      </View>

      <View className='search-shell'>
        <IconFont name='search' className='search-icon' />
        <Input className='search-input' value={q} placeholder='搜索款式、材质或灵感' confirmType='search' onInput={(event) => setQ(String(event.detail.value))} />
        {q && <Button className='search-clear' ariaLabel='清空搜索' onClick={() => setQ('')}><IconFont name='close' /></Button>}
      </View>

      <ScrollView className='category-scroll' scrollX enhanced showScrollbar={false}>
        <View className='category-track'>
          {categories.map((item) => (
            <Button key={item.slug} className={`category-chip ${category === item.slug ? 'active' : ''}`} hoverClass='category-chip-press' onClick={() => setCategory(item.slug)}>
              {item.name}
            </Button>
          ))}
        </View>
      </ScrollView>

      <View className='catalog-toolbar'>
        <Picker mode='selector' range={sortLabels} value={sortIndex} onChange={(event) => setSortIndex(Number(event.detail.value))}>
          <View className='sort-trigger'>{sortLabels[sortIndex]} <IconFont name='chevronDown' /></View>
        </Picker>
        <Text className='result-count'>{loading ? '正在策展…' : `${products.length} 件作品`}</Text>
        <Button className={`filter-trigger ${activeFilters ? 'has-filter' : ''}`} onClick={() => setShowFilters(true)}>
          <IconFont name='filter' /> 筛选{activeFilters ? ` · ${activeFilters}` : ''}
        </Button>
      </View>

      {loading ? (
        <View className='catalog-skeleton-grid'>{[0, 1, 2, 3].map((item) => <View key={item} className='catalog-skeleton' />)}</View>
      ) : products.length ? (
        <View className='product-grid' animation={productGridAnimation}>
          {products.map((product, index) => <ProductCard key={product.id} product={product} index={index} favorite={favoriteIds.includes(product.id)} onFavorite={favorite} />)}
        </View>
      ) : (
        <View className='catalog-empty'>
          <View className='empty-ring' />
          <Text className='empty-title'>暂时没有匹配的珠宝</Text>
          <Text className='empty-copy'>试着放宽价格或更换材质，也许会遇见另一件心动。</Text>
          <Button className='empty-action' onClick={resetFilters}>重置筛选</Button>
        </View>
      )}

      {showFilters && (
        <View className='filter-layer'>
          <View className='filter-backdrop' onClick={() => setShowFilters(false)} />
          <View className='filter-sheet'>
            <View className='sheet-head'>
              <View><Text className='sheet-kicker'>REFINE</Text><Text className='sheet-title'>筛选作品</Text></View>
              <Button className='sheet-close' ariaLabel='关闭筛选' onClick={() => setShowFilters(false)}><IconFont name='close' /></Button>
            </View>
            <Picker mode='selector' range={materialLabels} value={materialIndex} onChange={(event) => setMaterialIndex(Number(event.detail.value))}>
              <View className='filter-row'><Text>材质</Text><View className='row-value'><Text>{materialLabels[materialIndex]}</Text><IconFont name='chevronRight' /></View></View>
            </Picker>
            <View className='filter-block'>
              <Text className='filter-label'>价格区间</Text>
              <View className='price-fields'>
                <View className='price-field'><Text>¥</Text><Input type='number' value={minPrice} placeholder='最低价' onInput={(event) => setMinPrice(String(event.detail.value))} /></View>
                <Text className='price-divider'>—</Text>
                <View className='price-field'><Text>¥</Text><Input type='number' value={maxPrice} placeholder='最高价' onInput={(event) => setMaxPrice(String(event.detail.value))} /></View>
              </View>
            </View>
            <View className='filter-row'>
              <View><Text className='filter-main'>仅看有货</Text><Text className='filter-hint'>隐藏暂时售罄的款式</Text></View>
              <Switch color='#7A2630' checked={inStock} onChange={(event) => setInStock(event.detail.value)} />
            </View>
            <View className='sheet-actions'>
              <Button className='reset-action' onClick={resetFilters}>全部重置</Button>
              <Button className='apply-action' onClick={() => setShowFilters(false)}>查看 {products.length} 件作品</Button>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}
