import { useEffect, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'

type AnimationExport = ReturnType<ReturnType<typeof Taro.createAnimation>['export']>

function buildAnimation(duration: number, opacity: number, translateY: number, scale = 1) {
  const animation = Taro.createAnimation({
    duration,
    timingFunction: 'ease-out'
  })

  animation.opacity(opacity).translateY(translateY).scale(scale).step()
  return animation.export()
}

export function usePageEntranceAnimation() {
  const [animationData, setAnimationData] = useState<AnimationExport>(() => buildAnimation(0, 1, 0))

  useDidShow(() => {
    setAnimationData(buildAnimation(0, 0, 14, 0.992))
    setTimeout(() => {
      setAnimationData(buildAnimation(260, 1, 0, 1))
    }, 24)
  })

  return animationData
}

export function useContentRefreshAnimation(deps: unknown[]) {
  const didMount = useRef(false)
  const [animationData, setAnimationData] = useState<AnimationExport>(() => buildAnimation(0, 1, 0))

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true
      return
    }

    setAnimationData(buildAnimation(0, 0.68, 8, 0.996))
    const timer = setTimeout(() => {
      setAnimationData(buildAnimation(180, 1, 0, 1))
    }, 20)

    return () => clearTimeout(timer)
  }, deps)

  return animationData
}
