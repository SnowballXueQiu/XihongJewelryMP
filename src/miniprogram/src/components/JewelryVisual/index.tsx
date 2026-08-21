import { Image, Text, View } from '@tarojs/components'
import { Product } from '@/types/domain'
import './index.scss'

interface Props {
  product: Product
  compact?: boolean
  showLabel?: boolean
}

export default function JewelryVisual({ product, compact = false, showLabel = true }: Props) {
  return (
    <View className={`jewelry-visual ${compact ? 'is-compact' : ''}`} style={{ backgroundColor: product.image_color }}>
      {product.cover_url ? (
        <Image className='jewelry-photo' src={product.cover_url} mode='aspectFill' lazyLoad />
      ) : (
        <View className={`jewelry-art art-${product.category_slug}`}>
          <View className='art-orbit orbit-one' />
          <View className='art-orbit orbit-two' />
          <View className='art-stone' />
          <View className='art-chain' />
        </View>
      )}
      <View className='visual-grain' />
      {showLabel && product.tags?.[0] && <Text className='visual-label'>{product.tags[0]}</Text>}
    </View>
  )
}
