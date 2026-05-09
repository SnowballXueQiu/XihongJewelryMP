import { useEffect, useMemo, useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Input, Picker, ScrollView, Switch, Text, View } from '@tarojs/components'
import { fetchCategories, fetchProducts, formatMoney } from '@/services/api'
import { Category, Product } from '@/types/domain'
import './index.scss'

const materials = ['all', '18K金', '珍珠', '包金', '银']
const materialLabels = ['全部材质', '18K金', '珍珠', '包金', '银']
const sortOptions = ['recommended', 'price_asc', 'price_desc']
const sortLabels = ['推荐排序', '价格从低到高', '价格从高到低']

export default function ProductsPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [category, setCategory] = useState('all')
  const [q, setQ] = useState('')
  const [materialIndex, setMaterialIndex] = useState(0)
  const [sortIndex, setSortIndex] = useState(0)
  const [arOnly, setArOnly] = useState(false)
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')

  const material = useMemo(() => materials[materialIndex], [materialIndex])
  const sort = useMemo(() => sortOptions[sortIndex], [sortIndex])

  useEffect(() => {
    fetchCategories().then(setCategories)
  }, [])

  useEffect(() => {
    fetchProducts({ category, q, material, arOnly, minPrice, maxPrice, sort }).then(setProducts)
  }, [category, q, material, arOnly, minPrice, maxPrice, sort])

  function resetPrice() {
    setMinPrice('')
    setMaxPrice('')
  }

  return (
    <View className='page products-page'>
      <View className='search-bar'>
        <Input className='search-input' value={q} placeholder='搜索戒指、手链、材质' confirmType='search' onInput={(event) => setQ(String(event.detail.value))} />
        <Button className='cart-link' onClick={() => Taro.navigateTo({ url: '/pages/cart/index' })}>
          <Text className='cart-link-text'>购物车</Text>
        </Button>
      </View>

      <ScrollView className='category-scroll' scrollX>
        {categories.map((item) => (
          <Button key={item.slug} className={`category-chip ${category === item.slug ? 'active' : ''}`} onClick={() => setCategory(item.slug)}>
            {item.name}
          </Button>
        ))}
      </ScrollView>

      <View className='filters card'>
        <Picker mode='selector' range={materialLabels} value={materialIndex} onChange={(event) => setMaterialIndex(Number(event.detail.value))}>
          <View className='filter-cell'>{materialLabels[materialIndex]}</View>
        </Picker>
        <Picker mode='selector' range={sortLabels} value={sortIndex} onChange={(event) => setSortIndex(Number(event.detail.value))}>
          <View className='filter-cell'>{sortLabels[sortIndex]}</View>
        </Picker>
        <View className='price-row'>
          <View className='price-field'>
            <Text className='price-label'>最低价</Text>
            <Input className='price-input' type='number' value={minPrice} placeholder='0' confirmType='done' onInput={(event) => setMinPrice(String(event.detail.value))} />
          </View>
          <View className='price-field'>
            <Text className='price-label'>最高价</Text>
            <Input className='price-input' type='number' value={maxPrice} placeholder='不限' confirmType='done' onInput={(event) => setMaxPrice(String(event.detail.value))} />
          </View>
        </View>
        <View className='ar-row'>
          <Text>只看 AR 试戴</Text>
          <Switch color='#B89A63' checked={arOnly} onChange={(event) => setArOnly(event.detail.value)} />
        </View>
        {(minPrice || maxPrice) && (
          <Button className='reset-price' onClick={resetPrice}>清除价格区间</Button>
        )}
      </View>

      <View className='product-grid'>
        {products.map((product) => (
          <View key={product.id} className='product-card card' onClick={() => Taro.navigateTo({ url: `/pages/product-detail/index?id=${product.id}` })}>
            <View className='product-image' style={{ background: product.image_color }}>
              {product.supports_ar && <Text className='ar-badge'>AR</Text>}
            </View>
            <View className='product-body'>
              <Text className='product-name'>{product.name}</Text>
              <Text className='product-subtitle'>{product.subtitle}</Text>
              <View className='product-meta'>
                <Text className='product-price'>{formatMoney(product.price_cents)}</Text>
                <Text className='stock'>库存 {product.stock}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}
