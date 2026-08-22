import { Text, View } from '@tarojs/components'
import './index.scss'

interface LuxuryLoaderProps {
  label?: string
  compact?: boolean
  overlay?: boolean
}

export default function LuxuryLoader({ label = '正在为你甄选', compact = false, overlay = false }: LuxuryLoaderProps) {
  return (
    <View className={`luxury-loader ${compact ? 'is-compact' : ''} ${overlay ? 'is-overlay' : ''}`}>
      <View className='luxury-loader-mark' ariaLabel='加载中'>
        <View className='loader-orbit orbit-a'><View /></View>
        <View className='loader-orbit orbit-b'><View /></View>
        <View className='loader-core' />
      </View>
      <Text className='luxury-loader-label'>{label}</Text>
      <View className='luxury-loader-line'><View /></View>
    </View>
  )
}
