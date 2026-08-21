import { useMemo, useState } from 'react'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { claimCoupon, fetchCoupons, formatMoney } from '@/services/api'
import { Coupon } from '@/types/domain'
import './index.scss'

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [tab, setTab] = useState<'available' | 'used'>('available')
  const [claiming, setClaiming] = useState(0)
  const [loading, setLoading] = useState(true)

  async function load() {
    try { setCoupons(await fetchCoupons()) } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '礼券加载失败', icon: 'none' })
    } finally { setLoading(false); Taro.stopPullDownRefresh() }
  }
  useDidShow(() => { load() })
  usePullDownRefresh(load)
  const visible = useMemo(() => coupons.filter((coupon) => tab === 'used' ? coupon.used || !coupon.available : !coupon.used && coupon.available), [coupons, tab])

  async function claim(coupon: Coupon) {
    setClaiming(coupon.id)
    try {
      const next = await claimCoupon(coupon.id)
      setCoupons((current) => current.map((item) => item.id === next.id ? next : item))
      Taro.showToast({ title: '礼券已收入账户', icon: 'success' })
    } catch (error) { Taro.showToast({ title: error instanceof Error ? error.message : '领取失败', icon: 'none' }) }
    finally { setClaiming(0) }
  }

  return <View className='coupons-page'>
    <View className='coupon-head'><Text>PRIVATE BENEFITS</Text><Text>会员礼券</Text><Text>每一份礼遇，都为重要时刻而来。</Text></View>
    <View className='coupon-tabs'><Button className={tab === 'available' ? 'active' : ''} onClick={() => setTab('available')}>可使用</Button><Button className={tab === 'used' ? 'active' : ''} onClick={() => setTab('used')}>已失效</Button></View>
    <View className='coupon-list'>
      {loading && [0, 1].map((item) => <View className='coupon-skeleton' key={item} />)}
      {!loading && visible.map((coupon) => <View className={`coupon-card ${coupon.used || !coupon.available ? 'disabled' : ''}`} key={coupon.id}>
        <View className='coupon-value'><Text>{formatMoney(coupon.amount_cents).replace('¥', '')}</Text><Text>元</Text><Text>满 {formatMoney(coupon.minimum_cents)} 可用</Text></View>
        <View className='coupon-copy'><Text>{coupon.name}</Text><Text>{coupon.description}</Text><Text>{coupon.valid_until ? `有效期至 ${coupon.valid_until.slice(0, 10)}` : '长期有效'}</Text></View>
        <View className='coupon-edge' />
        {tab === 'available' && <Button disabled={coupon.claimed || claiming === coupon.id} loading={claiming === coupon.id} onClick={() => claim(coupon)}>{coupon.claimed ? '已领取' : '领取'}</Button>}
      </View>)}
      {!loading && !visible.length && <View className='coupon-empty'><Text>暂无{tab === 'available' ? '可用' : '失效'}礼券</Text><Text>关注会员活动，新礼遇会在这里出现</Text></View>}
    </View>
    <View className='coupon-rules'><Text>使用说明</Text><Text>礼券须在有效期内使用，每笔订单仅限使用一张；取消未支付订单后礼券会自动退回。具体适用范围以结算页为准。</Text></View>
  </View>
}
