import { useMemo } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { WebView, View } from '@tarojs/components'
import './index.scss'

const AR_H5_ORIGIN = 'https://ar.xihongzhubao.com'

export default function ArMediaPipePage() {
  const router = useRouter()

  const src = useMemo(() => {
    const productId = router.params.id || ''
    const params = new URLSearchParams({ productId })
    return `${AR_H5_ORIGIN}/?${params.toString()}`
  }, [router.params.id])

  return (
    <View className='ar-webview-page'>
      <WebView
        className='ar-webview'
        src={src}
        onError={() => {
          Taro.showToast({ title: 'AR 页面加载失败', icon: 'none' })
        }}
      />
    </View>
  )
}
