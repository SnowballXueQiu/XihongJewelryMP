import { useMemo, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, ScrollView, Text, View } from '@tarojs/components'
import {
  bindWechatPhone,
  fetchCoupons,
  fetchFavorites,
  fetchPet,
  fetchProducts,
  fetchStoreConfig,
  fetchUser,
  fetchWechatSyncedOrders,
  formatMoney,
  petAction
} from '@/services/api'
import { useContentRefreshAnimation } from '@/hooks/useSubtleAnimation'
import { Order, Pet, Product, StoreConfig, User } from '@/types/domain'
import IconFont from '@/components/IconFont'
import JewelryVisual from '@/components/JewelryVisual'
import LuxuryLoader from '@/components/LuxuryLoader'
import './index.scss'

const PHONE_PROMPT_KEY = 'xihong_phone_prompt_seen'

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null)
  const [pet, setPet] = useState<Pet | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [recommended, setRecommended] = useState<Product[]>([])
  const [storeConfig, setStoreConfig] = useState<StoreConfig | null>(null)
  const [favoriteCount, setFavoriteCount] = useState(0)
  const [couponCount, setCouponCount] = useState(0)
  const [petBusy, setPetBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showAuth, setShowAuth] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [binding, setBinding] = useState(false)
  const petAnimation = useContentRefreshAnimation([pet?.exp, pet?.mood, pet?.hunger, pet?.level])
  const progress = useMemo(() => pet ? Math.min(100, Math.round((pet.exp / Math.max(pet.next_level_exp, 1)) * 100)) : 0, [pet])
  const memberDays = useMemo(() => {
    if (!user?.created_at) return 1
    return Math.max(1, Math.ceil((Date.now() - new Date(user.created_at).getTime()) / 86400000))
  }, [user?.created_at])

  useDidShow(() => {
    setLoading(true)
    Promise.allSettled([
      fetchUser(), fetchPet(), fetchWechatSyncedOrders(), fetchFavorites(), fetchCoupons(),
      fetchProducts({ featured: true }), fetchStoreConfig()
    ]).then(([userResult, petResult, orderResult, favoriteResult, couponResult, productResult, storeResult]) => {
      if (userResult.status === 'fulfilled') {
        setUser(userResult.value)
        if (!userResult.value.phone && !Taro.getStorageSync(PHONE_PROMPT_KEY)) setShowAuth(true)
      }
      if (petResult.status === 'fulfilled') setPet(petResult.value)
      if (orderResult.status === 'fulfilled') setOrders(orderResult.value)
      if (favoriteResult.status === 'fulfilled') setFavoriteCount(favoriteResult.value.length)
      if (couponResult.status === 'fulfilled') setCouponCount(couponResult.value.filter((coupon) => coupon.claimed && coupon.available && !coupon.used).length)
      if (productResult.status === 'fulfilled') setRecommended(productResult.value.slice(0, 6))
      if (storeResult.status === 'fulfilled') setStoreConfig(storeResult.value)
    }).finally(() => setLoading(false))
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

  function closeAuth() {
    Taro.setStorageSync(PHONE_PROMPT_KEY, true)
    setShowAuth(false)
  }

  async function bindPhone(event: any) {
    const code = String(event?.detail?.code || '')
    const errMsg = String(event?.detail?.errMsg || '')
    if (!code) {
      if (!errMsg.includes('cancel')) Taro.showToast({ title: '未获得手机号授权，请重试', icon: 'none' })
      return
    }
    setBinding(true)
    try {
      const nextUser = await bindWechatPhone(code)
      setUser(nextUser)
      setShowAuth(false)
      Taro.setStorageSync(PHONE_PROMPT_KEY, true)
      Taro.showToast({ title: '手机号绑定成功', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '手机号绑定失败', icon: 'none' })
    } finally { setBinding(false) }
  }

  async function openPrivacy() {
    try {
      await Taro.openPrivacyContract()
    } catch {
      Taro.showModal({
        title: '玺鸿珠宝隐私说明',
        content: '手机号仅用于会员身份识别、订单通知与售后联系。我们不会将手机号用于未经许可的营销或向无关第三方提供。',
        showCancel: false,
        confirmText: '我知道了'
      })
    }
  }

  const orderCount = (statuses: string[], fulfillmentType?: Order['fulfillment_type']) => orders.filter((order) =>
    statuses.includes(order.status) && (!fulfillmentType || order.fulfillment_type === fulfillmentType)
  ).length
  const maskedPhone = user?.phone ? `${user.phone.slice(0, 3)}****${user.phone.slice(-4)}` : ''
  const menu = [
    { icon: 'location' as const, label: '收货地址', copy: '管理常用收件人', value: '', url: '/pages/addresses/index' },
    { icon: 'order' as const, label: '微信电子发票', copy: '确认收货后申请，查询卡包状态', value: '', url: '/pages/invoice-titles/index' },
    { icon: 'heart' as const, label: '心选收藏', copy: '重温心动作品', value: String(favoriteCount || ''), url: '/pages/favorites/index' },
    { icon: 'gift' as const, label: '优惠礼券', copy: '查看会员专属礼遇', value: String(couponCount || ''), url: '/pages/coupons/index' },
    { icon: 'cart' as const, label: '购物袋', copy: '继续未完成的挑选', value: '', url: '/pages/cart/index' }
  ]

  if (loading) return <View className='profile-page'><LuxuryLoader overlay label='正在开启会员礼遇' /></View>

  return (
    <View className='profile-page'>
      <View className='profile-hero'>
        <Text className='profile-kicker'>XIHONG PRIVILEGE</Text>
        <View className='member-row'>
          <View className='avatar' style={{ background: user?.avatar_color || '#74252D' }}><Text>{(user?.nickname || '玺').slice(0, 1)}</Text></View>
          <View className='member-identity'>
            <Text className='nickname'>{user?.nickname || '尊贵的客人'}</Text>
            <Text className='member-tier'>{user?.phone ? '珍藏会员 · MEMBER' : '登录后开启专属会员礼遇'}</Text>
            {user?.phone ? <Text className='bound-phone'>{maskedPhone}</Text> : <Button className='hero-bind' onClick={() => setShowAuth(true)}>绑定微信手机号</Button>}
          </View>
        </View>
        <View className='member-stats'><View><Text>{user?.points ?? 0}</Text><Text>会员积分</Text></View><View><Text>{orders.length}</Text><Text>珍藏订单</Text></View><View><Text>{favoriteCount}</Text><Text>心选作品</Text></View></View>
        <View className='member-number'><Text>MEMBER · DAY {memberDays}</Text><Text>NO. {String(user?.id || 1).padStart(6, '0')}</Text></View>
      </View>

      <View className='profile-content'>
        <View className='member-benefits'>
          <View><IconFont name='shipping' /><Text>顺丰保价</Text></View>
          <View><IconFont name='gift' /><Text>专属礼遇</Text></View>
          <View><IconFont name='service' /><Text>珠宝顾问</Text></View>
          <View><IconFont name='success' /><Text>终身保养</Text></View>
        </View>

        <View className='section-head'><Text>订单中心</Text><Button onClick={() => Taro.navigateTo({ url: '/pages/orders/index' })}>全部订单 <IconFont name='chevronRight' /></Button></View>
        <View className='order-shortcuts'>
          <Button onClick={() => Taro.navigateTo({ url: '/pages/orders/index?status=pending_payment' })}><View className='shortcut-icon'><IconFont name='wallet' /></View><Text>待支付</Text>{orderCount(['pending_payment']) > 0 && <Text className='count'>{orderCount(['pending_payment'])}</Text>}</Button>
          <Button onClick={() => Taro.navigateTo({ url: '/pages/orders/index?status=processing' })}><View className='shortcut-icon'><IconFont name='package' /></View><Text>待发货</Text>{orderCount(['paid', 'preparing'], 'delivery') > 0 && <Text className='count'>{orderCount(['paid', 'preparing'], 'delivery')}</Text>}</Button>
          <Button onClick={() => Taro.navigateTo({ url: '/pages/orders/index?status=pickup' })}><View className='shortcut-icon'><IconFont name='location' /></View><Text>待取货</Text>{orderCount(['pickup_ready'], 'pickup') > 0 && <Text className='count'>{orderCount(['pickup_ready'], 'pickup')}</Text>}</Button>
          <Button onClick={() => Taro.navigateTo({ url: '/pages/orders/index?status=shipped' })}><View className='shortcut-icon'><IconFont name='shipping' /></View><Text>待收货</Text>{orderCount(['in_transit', 'shipped'], 'delivery') > 0 && <Text className='count'>{orderCount(['in_transit', 'shipped'], 'delivery')}</Text>}</Button>
        </View>

        {recommended.length > 0 && <View className='recommend-section'>
          <View className='section-head editorial-head'><View><Text>为你推荐</Text><Text>根据本季精选，为你挑选</Text></View><Text>01 — {String(recommended.length).padStart(2, '0')}</Text></View>
          <ScrollView className='recommend-scroll' scrollX enhanced showScrollbar={false} enableFlex>
            <View className='recommend-track'>{recommended.map((product) => <View key={product.id} className='recommend-card' onClick={() => Taro.navigateTo({ url: `/pages/product-detail/index?id=${product.id}` })}>
              <JewelryVisual product={product} compact />
              <Text className='recommend-name'>{product.name}</Text><Text className='recommend-meta'>{product.material}</Text><Text className='recommend-price'>{formatMoney(product.price_cents)}</Text>
            </View>)}</View>
          </ScrollView>
        </View>}

        <View className='appointment-panel'>
          <Text className='appointment-kicker'>PRIVATE APPOINTMENT</Text><Text className='appointment-title'>尊享预约服务</Text>
          <Text className='appointment-copy'>珠宝顾问将在营业时间内，为你提供到店鉴赏、清洁保养与选购建议。</Text>
          <View className='appointment-actions'>
            <Button openType='contact'><IconFont name='service' /> 在线顾问</Button>
            <Button onClick={() => storeConfig?.pickup_store_phone && Taro.makePhoneCall({ phoneNumber: storeConfig.pickup_store_phone })}><IconFont name='info' /> 电话咨询</Button>
          </View>
          {storeConfig && <Text className='store-address'>{storeConfig.pickup_store_name} · {storeConfig.pickup_store_address}</Text>}
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

        <View className='section-head'><Text>客户服务</Text><Text /></View>
        <View className='service-menu'>{menu.map((item) => <Button key={item.label} hoverClass='menu-press' onClick={() => item.url === '/pages/cart/index' ? Taro.switchTab({ url: item.url }) : Taro.navigateTo({ url: item.url })}><View className='menu-icon'><IconFont name={item.icon} /></View><View className='menu-copy'><Text>{item.label}</Text><Text>{item.copy}</Text></View><View className='menu-tail'>{item.value && <Text className='menu-value'>{item.value}</Text>}<IconFont name='chevronRight' className='arrow' /></View></Button>)}</View>
        <View className='profile-assurance'><Text>终身保养 · 正品承诺 · 专属顾问</Text><Text>XIHONG JEWELRY</Text></View>
      </View>

      {showAuth && <View className='auth-layer'>
        <View className='auth-backdrop' onClick={closeAuth} />
        <View className='auth-sheet'>
          <View className='auth-head'><View><Text className='auth-brand'>玺鸿珠宝</Text><Text className='auth-title'>登录会员账户</Text></View><Button className='auth-close' onClick={closeAuth}><IconFont name='close' /></Button></View>
          <Text className='auth-copy'>授权玺鸿获取你的微信绑定手机号，用于识别会员身份、同步订单与提供售后服务。</Text>
          <View className='auth-benefits'><View><IconFont name='shipping' /><Text>保价配送</Text></View><View><IconFont name='gift' /><Text>会员礼遇</Text></View><View><IconFont name='service' /><Text>专属顾问</Text></View></View>
          <Button className={`privacy-check ${privacyAccepted ? 'checked' : ''}`} hoverClass='none' onClick={() => setPrivacyAccepted((value) => !value)}>
            <View /><Text>我已阅读并同意</Text><Text className='privacy-link' onClick={(event) => { event.stopPropagation(); openPrivacy() }}>《隐私保护指引》</Text><Text>与《用户协议》</Text>
          </Button>
          <Text className='age-copy'>继续即表示你已满 14 周岁；手机号不会在未经允许的情况下用于无关营销。</Text>
          <Button className='phone-auth-button' openType='getPhoneNumber' disabled={!privacyAccepted || binding} loading={binding} onGetPhoneNumber={bindPhone}>授权并绑定手机号</Button>
          <Button className='auth-later' hoverClass='none' onClick={closeAuth}>暂不绑定</Button>
        </View>
      </View>}
    </View>
  )
}
