import { useMemo } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { WebView, View } from '@tarojs/components'
import './index.scss'

const DEFAULT_AR_WEB_ORIGIN = 'https://api.xihongzhubao.com'

export default function ArMediaPipePage() {
  const router = useRouter()

  const src = useMemo(() => {
    const productId = router.params.id || ''
    const params = new URLSearchParams({
      productId,
      title: '玺鸿珠宝 AR 试戴'
    })

    return `${DEFAULT_AR_WEB_ORIGIN}/mediapipe-ar/index.html?${params.toString()}`
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
