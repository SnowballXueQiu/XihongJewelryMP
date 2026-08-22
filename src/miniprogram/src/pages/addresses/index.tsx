import { useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { fetchAddresses } from '@/services/api'
import { Address } from '@/types/domain'
import IconFont from '@/components/IconFont'
import LuxuryLoader from '@/components/LuxuryLoader'
import './index.scss'

export default function AddressesPage() {
  const router = useRouter()
  const [addresses, setAddresses] = useState<Address[]>([])
  const [loading, setLoading] = useState(true)
  const selecting = router.params.select === '1'

  useDidShow(() => {
    setLoading(true)
    fetchAddresses().then(setAddresses).catch((error) => Taro.showToast({ title: error instanceof Error ? error.message : '地址加载失败', icon: 'none' })).finally(() => setLoading(false))
  })

  function choose(address: Address) {
    if (!selecting) return
    Taro.setStorageSync('selected_address_id', address.id)
    Taro.navigateBack()
  }

  return (
    <View className='page addresses-page'>
      <View className='addresses-head'><Text className='addresses-kicker'>DELIVERY BOOK</Text><Text className='addresses-title'>{selecting ? '选择收货地址' : '地址簿'}</Text></View>
      {loading ? <LuxuryLoader label='正在读取常用地址' /> : addresses.length ? (
        <View className='address-list'>
          {addresses.map((address, index) => (
            <View key={address.id} className='address-item' style={{ animationDelay: `${index * 45}ms` }} onClick={() => choose(address)}>
              <View className='address-index'><Text>{String(index + 1).padStart(2, '0')}</Text>{address.is_default && <Text>DEFAULT</Text>}</View>
              <View className='address-copy'>
                <Text className='address-person'>{address.receiver_name} · {address.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}</Text>
                <Text className='address-detail'>{address.province} {address.city} {address.district}{'\n'}{address.detail}</Text>
              </View>
              <Button className='edit-address' onClick={(event) => { event.stopPropagation(); Taro.navigateTo({ url: `/pages/address-edit/index?id=${address.id}` }) }}>编辑</Button>
            </View>
          ))}
        </View>
      ) : (
        <View className='address-empty'><Text>还没有收货地址</Text><Text>添加常用地址，结算会更快一些。</Text></View>
      )}
      <Button className='add-address' hoverClass='button-press' onClick={() => Taro.navigateTo({ url: '/pages/address-edit/index' })}><IconFont name='plus' />新增收货地址</Button>
    </View>
  )
}
