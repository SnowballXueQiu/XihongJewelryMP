import { useMemo, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { fetchCoupons, fetchFavorites, fetchOrders, fetchPet, fetchUser, petAction } from '@/services/api'
import { useContentRefreshAnimation, usePageEntranceAnimation } from '@/hooks/useSubtleAnimation'
import { Order, Pet, User } from '@/types/domain'
import IconFont from '@/components/IconFont'
import './index.scss'

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null)
  const [pet, setPet] = useState<Pet | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [favoriteCount, setFavoriteCount] = useState(0)
  const [couponCount, setCouponCount] = useState(0)
  const [petBusy, setPetBusy] = useState(false)
  const pageAnimation = usePageEntranceAnimation()
  const petAnimation = useContentRefreshAnimation([pet?.exp, pet?.mood, pet?.hunger, pet?.level])
  const progress = useMemo(() => pet ? Math.min(100, Math.round((pet.exp / Math.max(pet.next_level_exp, 1)) * 100)) : 0, [pet])

  useDidShow(() => {
    Promise.allSettled([fetchUser(), fetchPet(), fetchOrders(), fetchFavorites(), fetchCoupons()]).then(([userResult, petResult, orderResult, favoriteResult, couponResult]) => {
      if (userResult.status === 'fulfilled') setUser(userResult.value)
      if (petResult.status === 'fulfilled') setPet(petResult.value)
      if (orderResult.status === 'fulfilled') setOrders(orderResult.value)
      if (favoriteResult.status === 'fulfilled') setFavoriteCount(favoriteResult.value.length)
      if (couponResult.status === 'fulfilled') setCouponCount(couponResult.value.filter((coupon) => coupon.claimed && coupon.available && !coupon.used).length)
    })
  })

  async function interact(action: 'feed' | 'pet' | 'checkin') {
    if (petBusy) return
    setPetBusy(true)
    try {
      setPet(await petAction(action))
      Taro.vibrateShort({ type: 'light' }).catch(() => undefined)
      Taro.showToast({ title: action === 'checkin' ? '今日签到成功' : '成长值已增加', icon: 'success' })
    } catch (error) { Taro.showToast({ title: error instanceof Error ? error.message : '互动失败', icon: 'none' }) }
    finally { setPetBusy(false) }
  }

  const orderCount = (statuses: string[]) => orders.filter((order) => statuses.includes(order.status)).length
  const menu = [
    { label: '收货地址', copy: '管理常用收件人', value: '', url: '/pages/addresses/index' },
    { label: '心选收藏', copy: '重温心动作品', value: String(favoriteCount || ''), url: '/pages/favorites/index' },
    { label: '优惠礼券', copy: '查看会员专属礼遇', value: String(couponCount || ''), url: '/pages/coupons/index' },
    { label: '购物袋', copy: '继续未完成的挑选', value: '', url: '/pages/cart/index' }
  ]

  return (
    <View className='profile-page' animation={pageAnimation}>
      <View className='profile-hero'>
        <Text className='profile-kicker'>XIHONG PRIVILEGE</Text>
        <View className='member-row'><View className='avatar' style={{ background: user?.avatar_color || '#74252D' }}><Text>{(user?.nickname || '玺').slice(0, 1)}</Text></View><View><Text className='nickname'>{user?.nickname || '玺鸿会员'}</Text><Text className='member-tier'>珍藏会员 · MEMBER</Text></View></View>
        <View className='member-stats'><View><Text>{user?.points ?? 0}</Text><Text>会员积分</Text></View><View><Text>{orders.length}</Text><Text>珍藏订单</Text></View><View><Text>{favoriteCount}</Text><Text>心选作品</Text></View></View>
        <View className='member-number'><Text>MEMBER SINCE 2026</Text><Text>NO. {String(user?.id || 1).padStart(6, '0')}</Text></View>
      </View>

      <View className='profile-content'>
        <View className='section-head'><Text>订单中心</Text><Button onClick={() => Taro.navigateTo({ url: '/pages/orders/index' })}>全部订单 <IconFont name='chevronRight' /></Button></View>
        <View className='order-shortcuts'>
          <Button onClick={() => Taro.navigateTo({ url: '/pages/orders/index?status=pending_payment' })}><View className='shortcut-icon'><IconFont name='wallet' /></View><Text>待支付</Text>{orderCount(['pending_payment']) > 0 && <Text className='count'>{orderCount(['pending_payment'])}</Text>}</Button>
          <Button onClick={() => Taro.navigateTo({ url: '/pages/orders/index?status=processing' })}><View className='shortcut-icon'><IconFont name='package' /></View><Text>待发货</Text>{orderCount(['paid', 'preparing']) > 0 && <Text className='count'>{orderCount(['paid', 'preparing'])}</Text>}</Button>
          <Button onClick={() => Taro.navigateTo({ url: '/pages/orders/index?status=shipped' })}><View className='shortcut-icon'><IconFont name='shipping' /></View><Text>待收货</Text>{orderCount(['shipped']) > 0 && <Text className='count'>{orderCount(['shipped'])}</Text>}</Button>
          <Button openType='contact'><View className='shortcut-icon'><IconFont name='service' /></View><Text>售后咨询</Text></Button>
        </View>

        <View className='section-head pet-heading'><View><Text>会员守护灵</Text><Text>每天互动，积累专属礼遇</Text></View><Text>Lv.{pet?.level || 1}</Text></View>
        <View className='pet-card' animation={petAnimation}>
          <View className='pet-stage'><View className='pet-halo halo-one' /><View className='pet-halo halo-two' /><View className='pet-gem'><View /></View><Text>{pet?.name || '玺宝'}</Text></View>
          <View className='pet-panel'>
            <View className='pet-status'><Text>成长进度</Text><Text>{pet?.exp || 0} / {pet?.next_level_exp || 100}</Text></View><View className='progress-track'><View className='progress-bar' style={{ width: `${progress}%` }} /></View>
            <View className='pet-vitals'><Text>心情 {pet?.mood || 0}</Text><Text>饱腹 {pet?.hunger || 0}</Text><Text>{pet?.reward || '新人礼遇'}</Text></View>
            <View className='pet-actions'><Button disabled={petBusy} onClick={() => interact('feed')}>喂养</Button><Button disabled={petBusy} onClick={() => interact('pet')}>抚摸</Button><Button className='checkin' disabled={petBusy} onClick={() => interact('checkin')}>每日签到</Button></View>
          </View>
        </View>

        <View className='section-head'><Text>我的服务</Text><Text /></View>
        <View className='service-menu'>{menu.map((item, index) => <Button key={item.label} hoverClass='menu-press' onClick={() => item.url === '/pages/cart/index' ? Taro.switchTab({ url: item.url }) : Taro.navigateTo({ url: item.url })}><Text className='menu-index'>0{index + 1}</Text><View><Text>{item.label}</Text><Text>{item.copy}</Text></View>{item.value && <Text className='menu-value'>{item.value}</Text>}<IconFont name='chevronRight' className='arrow' /></Button>)}</View>
        <View className='profile-assurance'><Text>终身保养 · 正品承诺 · 专属顾问</Text><Text>XIHONG JEWELRY</Text></View>
      </View>
    </View>
  )
}
