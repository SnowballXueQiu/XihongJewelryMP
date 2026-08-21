import Taro from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import JewelryVisual from '@/components/JewelryVisual'
import IconFont from '@/components/IconFont'
import { formatMoney } from '@/services/api'
import { Product } from '@/types/domain'
import './index.scss'

interface Props {
  product: Product
  index?: number
  onFavorite?: (product: Product) => void
  favorite?: boolean
}

export default function ProductCard({ product, index = 0, onFavorite, favorite = false }: Props) {
  const open = () => Taro.navigateTo({ url: `/pages/product-detail/index?id=${product.id}` })
  return (
    <View className='catalog-card' style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }} onClick={open}>
      <JewelryVisual product={product} compact />
      {onFavorite && (
        <Button
          className={`favorite-button ${favorite ? 'is-active' : ''}`}
          hoverClass='favorite-press'
          onClick={(event) => {
            event.stopPropagation()
            onFavorite(product)
          }}
        >
          <IconFont name={favorite ? 'heartFilled' : 'heart'} />
        </Button>
      )}
      <View className='catalog-copy'>
        <Text className='catalog-kicker'>{product.material} · 已售 {product.sales}</Text>
        <Text className='catalog-name'>{product.name}</Text>
        <Text className='catalog-subtitle'>{product.subtitle}</Text>
        <View className='catalog-price-row'>
          <Text className='catalog-price'>{formatMoney(product.price_cents)}</Text>
          {product.original_price_cents > product.price_cents && (
            <Text className='catalog-original'>{formatMoney(product.original_price_cents)}</Text>
          )}
        </View>
      </View>
    </View>
  )
}
