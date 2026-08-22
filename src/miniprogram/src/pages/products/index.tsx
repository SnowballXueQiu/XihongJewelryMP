import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { Button, Input, Picker, ScrollView, Switch, Text, View } from '@tarojs/components'
import IconFont from '@/components/IconFont'
import JewelryVisual from '@/components/JewelryVisual'
import LuxuryLoader from '@/components/LuxuryLoader'
import { fetchCategories, fetchFavorites, fetchProducts, formatMoney, toggleFavorite } from '@/services/api'
import { usePageEntranceAnimation } from '@/hooks/useSubtleAnimation'
import { Category, Product } from '@/types/domain'
import './index.scss'

const materials = ['all', '18K金', '18K白金', '14K金', '足金', '珍珠', '包金', '银']
const materialLabels = ['全部材质', '18K 金', '18K 白金', '14K 金', '足金', '珍珠', '包金', '925 银']
const sortOptions = ['recommended', 'sales', 'newest', 'price_asc', 'price_desc']
const sortLabels = ['精选排序', '销量优先', '上新优先', '价格从低到高', '价格从高到低']

interface CatalogGroup { category: Category; products: Product[] }

export default function ProductsPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [favoriteIds, setFavoriteIds] = useState<number[]>([])
  const [activeSlug, setActiveSlug] = useState('')
  const [rightIntoView, setRightIntoView] = useState('')
  const [rightScrollTop, setRightScrollTop] = useState(0)
  const [leftIntoView, setLeftIntoView] = useState('')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [materialIndex, setMaterialIndex] = useState(0)
  const [sortIndex, setSortIndex] = useState(0)
  const [inStock, setInStock] = useState(false)
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [loading, setLoading] = useState(true)
  const sectionMetrics = useRef<Array<{ slug: string; top: number }>>([])
  const currentScrollTop = useRef(0)
  const requestedCategory = useRef('')
  const pageAnimation = usePageEntranceAnimation()

  const material = useMemo(() => materials[materialIndex], [materialIndex])
  const sort = useMemo(() => sortOptions[sortIndex], [sortIndex])
  const activeFilters = Number(materialIndex > 0) + Number(inStock) + Number(Boolean(minPrice || maxPrice))
  const catalogCategories = useMemo(() => categories.filter((item) => item.slug !== 'all'), [categories])
  const groups = useMemo<CatalogGroup[]>(() => catalogCategories
    .map((item) => ({ category: item, products: products.filter((product) => product.category_slug === item.slug) }))
    .filter((group) => group.products.length > 0), [catalogCategories, products])

  const loadProducts = useCallback(async () => {
    setLoading(true)
    try {
      const [nextCategories, nextProducts] = await Promise.all([
        fetchCategories(),
        fetchProducts({ q: search, material, inStock, minPrice, maxPrice, sort })
      ])
      setCategories(nextCategories)
      setProducts(nextProducts)
    } finally { setLoading(false) }
  }, [search, material, inStock, minPrice, maxPrice, sort])

  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), 280)
    return () => clearTimeout(timer)
  }, [q])

  useEffect(() => { loadProducts() }, [loadProducts])

  useEffect(() => {
    if (!groups.length) return
    const target = groups.some((group) => group.category.slug === requestedCategory.current)
      ? requestedCategory.current
      : groups.some((group) => group.category.slug === activeSlug) ? activeSlug : groups[0].category.slug
    requestedCategory.current = ''
    setActiveSlug(target)
    setLeftIntoView(`nav-${target}`)
    if (target !== groups[0].category.slug) setTimeout(() => setRightIntoView(`catalog-${target}`), 80)
    setTimeout(() => {
      measureSections()
      const metric = sectionMetrics.current.find((item) => item.slug === target)
      if (metric) setRightScrollTop(metric.top)
    }, 180)
  }, [groups.length, products])

  useDidShow(() => {
    const pendingCategory = Taro.getStorageSync<string>('catalog_category')
    if (pendingCategory) {
      requestedCategory.current = pendingCategory
      Taro.removeStorageSync('catalog_category')
    }
    fetchFavorites().then((items) => setFavoriteIds(items.map((item) => item.product.id))).catch(() => undefined)
  })

  usePullDownRefresh(() => {
    Promise.all([loadProducts(), fetchFavorites().then((items) => setFavoriteIds(items.map((item) => item.product.id)))])
      .finally(() => Taro.stopPullDownRefresh())
  })

  function measureSections() {
    Taro.nextTick(() => {
      const query = Taro.createSelectorQuery()
      query.select('.catalog-content').boundingClientRect()
      query.selectAll('.catalog-section').boundingClientRect()
      query.exec((result) => {
        const container = result?.[0]
        const sections = result?.[1] as Array<{ top: number }> | undefined
        if (!container || !sections?.length) return
        sectionMetrics.current = sections.map((section, index) => ({
          slug: groups[index]?.category.slug || '',
          top: section.top - container.top + currentScrollTop.current
        })).filter((item) => item.slug)
      })
    })
  }

  function scrollToCategory(slug: string) {
    const query = Taro.createSelectorQuery()
    query.select('.catalog-content').boundingClientRect()
    query.select(`#catalog-${slug}`).boundingClientRect()
    query.select('.catalog-content').scrollOffset()
    query.exec((result) => {
      const container = result?.[0]
      const target = result?.[1]
      const offset = result?.[2]
      if (!container || !target) return
      const top = Number(offset?.scrollTop || currentScrollTop.current) + target.top - container.top
      setRightScrollTop(top + (rightScrollTop === top ? .1 : 0))
    })
  }

  function selectCategory(slug: string) {
    setActiveSlug(slug)
    setLeftIntoView(`nav-${slug}`)
    setRightIntoView(`catalog-${slug}`)
    const metric = sectionMetrics.current.find((item) => item.slug === slug)
    const groupIndex = groups.findIndex((group) => group.category.slug === slug)
    const estimatedTop = groups.slice(0, Math.max(0, groupIndex)).reduce(
      (total, group) => total + 65 + Math.ceil(group.products.length / 2) * 180,
      0
    )
    const targetTop = metric?.top ?? estimatedTop
    setRightScrollTop(targetTop + (rightScrollTop === targetTop ? .1 : 0))
    scrollToCategory(slug)
    Taro.vibrateShort({ type: 'light' }).catch(() => undefined)
  }

  function onCatalogScroll(event: any) {
    const scrollTop = Number(event?.detail?.scrollTop || 0)
    currentScrollTop.current = scrollTop
    let next = sectionMetrics.current[0]?.slug || activeSlug
    for (const metric of sectionMetrics.current) {
      if (scrollTop + 80 >= metric.top) next = metric.slug
      else break
    }
    if (next && next !== activeSlug) {
      setActiveSlug(next)
      setLeftIntoView(`nav-${next}`)
    }
  }

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
    <View className='products-page' animation={pageAnimation}>
      <View className='catalog-head'>
        <View><Text className='catalog-eyebrow'>THE COLLECTION</Text><Text className='catalog-title'>珠宝分类</Text><Text className='catalog-subtitle'>从形制与材质，遇见适合你的作品</Text></View>
        <Button className='catalog-bag' hoverClass='none' ariaLabel='购物袋' onClick={() => Taro.switchTab({ url: '/pages/cart/index' })}><IconFont name='cart' /></Button>
      </View>

      <View className='search-shell'>
        <IconFont name='search' className='search-icon' />
        <Input className='search-input' value={q} placeholder='搜索款式、材质或灵感' confirmType='search' onInput={(event) => setQ(String(event.detail.value))} />
        {q && <Button className='search-clear' ariaLabel='清空搜索' onClick={() => setQ('')}><IconFont name='close' /></Button>}
      </View>

      <View className='catalog-toolbar'>
        <Picker mode='selector' range={sortLabels} value={sortIndex} onChange={(event) => setSortIndex(Number(event.detail.value))}>
          <View className='sort-trigger'>{sortLabels[sortIndex]} <IconFont name='chevronDown' /></View>
        </Picker>
        <Text className='result-count'>{loading ? '正在策展…' : `${products.length} 件作品`}</Text>
        <Button className={`filter-trigger ${activeFilters ? 'has-filter' : ''}`} onClick={() => setShowFilters(true)}><IconFont name='filter' /> 筛选{activeFilters ? ` · ${activeFilters}` : ''}</Button>
      </View>

      {loading ? <LuxuryLoader label='正在整理珠宝分类' /> : groups.length ? <View className='catalog-browser'>
        <ScrollView className='catalog-nav' scrollY showScrollbar={false} scrollIntoView={leftIntoView} scrollWithAnimation>
          <View className='catalog-nav-inner'>{groups.map((group, index) => <Button
            id={`nav-${group.category.slug}`}
            key={group.category.slug}
            className={`catalog-nav-item ${activeSlug === group.category.slug ? 'active' : ''}`}
            onClick={() => selectCategory(group.category.slug)}
          ><Text className='nav-index'>{String(index + 1).padStart(2, '0')}</Text><Text>{group.category.name}</Text><View /></Button>)}</View>
        </ScrollView>
        <ScrollView
          className='catalog-content'
          scrollY
          showScrollbar={false}
          scrollIntoView={rightIntoView}
          scrollTop={rightScrollTop}
          scrollWithAnimation
          onScroll={onCatalogScroll}
          onTouchEnd={measureSections}
        >
          <View className='catalog-content-inner'>{groups.map((group, groupIndex) => <View className='catalog-section' id={`catalog-${group.category.slug}`} key={group.category.slug}>
            <View className='catalog-section-head'><View><Text className='section-en'>COLLECTION {String(groupIndex + 1).padStart(2, '0')}</Text><Text className='section-name'>{group.category.name}</Text></View><Text>{group.products.length} 件</Text></View>
            <View className='catalog-card-grid'>{group.products.map((product) => <View className='catalog-card' key={product.id} onClick={() => Taro.navigateTo({ url: `/pages/product-detail/index?id=${product.id}` })}>
              <View className='catalog-card-visual'><JewelryVisual product={product} compact /><Button className={`catalog-heart ${favoriteIds.includes(product.id) ? 'active' : ''}`} ariaLabel='收藏' onClick={(event) => { event.stopPropagation(); favorite(product) }}><IconFont name={favoriteIds.includes(product.id) ? 'heartFilled' : 'heart'} /></Button></View>
              <Text className='catalog-card-name'>{product.name}</Text><Text className='catalog-card-meta'>{product.subtitle}</Text><Text className='catalog-card-price'>{formatMoney(product.price_cents)}</Text>
            </View>)}</View>
          </View>)}</View>
        </ScrollView>
      </View> : <View className='catalog-empty'><View className='empty-ring' /><Text className='empty-title'>暂时没有匹配的珠宝</Text><Text className='empty-copy'>试着放宽价格或更换材质，也许会遇见另一件心动。</Text><Button className='empty-action' onClick={resetFilters}>重置筛选</Button></View>}

      {showFilters && <View className='filter-layer'>
        <View className='filter-backdrop' onClick={() => setShowFilters(false)} />
        <View className='filter-sheet'>
          <View className='sheet-head'><View><Text className='sheet-kicker'>REFINE</Text><Text className='sheet-title'>筛选作品</Text></View><Button className='sheet-close' ariaLabel='关闭筛选' onClick={() => setShowFilters(false)}><IconFont name='close' /></Button></View>
          <Picker mode='selector' range={materialLabels} value={materialIndex} onChange={(event) => setMaterialIndex(Number(event.detail.value))}><View className='filter-row'><Text>材质</Text><View className='row-value'><Text>{materialLabels[materialIndex]}</Text><IconFont name='chevronRight' /></View></View></Picker>
          <View className='filter-block'><Text className='filter-label'>价格区间</Text><View className='price-fields'><View className='price-field'><Text>¥</Text><Input type='number' value={minPrice} placeholder='最低价' onInput={(event) => setMinPrice(String(event.detail.value))} /></View><Text className='price-divider'>—</Text><View className='price-field'><Text>¥</Text><Input type='number' value={maxPrice} placeholder='最高价' onInput={(event) => setMaxPrice(String(event.detail.value))} /></View></View></View>
          <View className='filter-row'><View><Text className='filter-main'>仅看有货</Text><Text className='filter-hint'>隐藏暂时售罄的款式</Text></View><Switch color='#7A2630' checked={inStock} onChange={(event) => setInStock(event.detail.value)} /></View>
          <View className='sheet-actions'><Button className='reset-action' onClick={resetFilters}>全部重置</Button><Button className='apply-action' onClick={() => setShowFilters(false)}>查看 {products.length} 件作品</Button></View>
        </View>
      </View>}
    </View>
  )
}
