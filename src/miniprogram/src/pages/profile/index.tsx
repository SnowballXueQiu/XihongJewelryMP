import { useEffect, useMemo, useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { fetchPet, fetchUser, petAction } from '@/services/api'
import { Pet, User } from '@/types/domain'
import './index.scss'

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null)
  const [pet, setPet] = useState<Pet | null>(null)
  const progress = useMemo(() => {
    if (!pet) return 0
    return Math.min(100, Math.round((pet.exp / pet.next_level_exp) * 100))
  }, [pet])

  useEffect(() => {
    fetchUser().then(setUser)
    fetchPet().then(setPet)
  }, [])

  async function interact(action: 'feed' | 'pet' | 'checkin') {
    const next = await petAction(action)
    setPet(next)
    Taro.showToast({ title: '成长值已增加', icon: 'success' })
  }

  return (
    <View className='page profile-page'>
      <View className='member card'>
        <View className='avatar' style={{ background: user?.avatar_color || '#913F5F' }} />
        <View className='member-info'>
          <Text className='nickname'>{user?.nickname || '玺鸿会员'}</Text>
          <Text className='member-sub'>积分 {user?.points ?? 0} · 微信 openid 待接入</Text>
        </View>
      </View>

      <Text className='section-title'>会员成长宠物</Text>
      <View className='pet-card card'>
        <View className='pet-stage'>
          <View className='pet-body'>
            <View className='pet-gem' />
          </View>
        </View>
        <View className='pet-info'>
          <Text className='pet-name'>{pet?.name || '玺宝'} · Lv{pet?.level || 1}</Text>
          <Text className='pet-state'>心情 {pet?.mood || 0} · 饥饿 {pet?.hunger || 0}</Text>
          <View className='progress-track'>
            <View className='progress-bar' style={{ width: `${progress}%` }} />
          </View>
          <Text className='reward'>当前权益：{pet?.reward || '新人清洁布'}</Text>
        </View>
        <View className='pet-actions'>
          <Button className='ghost-btn pet-action' onClick={() => interact('feed')}>喂养</Button>
          <Button className='ghost-btn pet-action' onClick={() => interact('pet')}>抚摸</Button>
          <Button className='primary-btn pet-action' onClick={() => interact('checkin')}>签到</Button>
        </View>
      </View>

      <Text className='section-title'>个人管理</Text>
      <View className='menu card'>
        <Button className='menu-item'>资料管理</Button>
        <Button className='menu-item'>收货地址</Button>
        <Button className='menu-item' onClick={() => Taro.navigateTo({ url: '/pages/cart/index' })}>购物车</Button>
        <Button className='menu-item'>订单记录</Button>
      </View>
    </View>
  )
}
