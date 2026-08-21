import { useEffect, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Button, Input, Picker, Switch, Text, View } from '@tarojs/components'
import { createAddress, deleteAddress, fetchAddresses, updateAddress } from '@/services/api'
import { AddressPayload } from '@/types/domain'
import IconFont from '@/components/IconFont'
import './index.scss'

const emptyAddress: AddressPayload = {
  receiver_name: '',
  phone: '',
  province: '',
  city: '',
  district: '',
  detail: '',
  postal_code: '',
  is_default: false
}

export default function AddressEditPage() {
  const router = useRouter()
  const id = Number(router.params.id || 0)
  const [form, setForm] = useState<AddressPayload>(emptyAddress)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    fetchAddresses().then((items) => {
      const address = items.find((item) => item.id === id)
      if (address) {
        const { id: _, ...payload } = address
        setForm(payload)
      }
    })
  }, [id])

  function setField<K extends keyof AddressPayload>(key: K, value: AddressPayload[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    if (!form.receiver_name.trim() || !/^1\d{10}$/.test(form.phone) || !form.province || !form.detail.trim()) {
      Taro.showToast({ title: '请完整填写姓名、手机号、地区和详细地址', icon: 'none' })
      return
    }
    setSaving(true)
    try {
      if (id) await updateAddress(id, form)
      else await createAddress(form)
      Taro.showToast({ title: '地址已保存', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 450)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    const modal = await Taro.showModal({ title: '删除地址？', content: '删除后无法恢复。', confirmText: '删除', confirmColor: '#7A2630' })
    if (!modal.confirm) return
    await deleteAddress(id)
    Taro.navigateBack()
  }

  return (
    <View className='page address-edit-page'>
      <View className='edit-head'><Text className='edit-kicker'>DELIVERY DETAILS</Text><Text className='edit-title'>{id ? '编辑地址' : '新增地址'}</Text></View>
      <View className='address-form'>
        <View className='form-field'><Text>收货人</Text><Input value={form.receiver_name} maxlength={30} placeholder='姓名' onInput={(event) => setField('receiver_name', String(event.detail.value))} /></View>
        <View className='form-field'><Text>手机号</Text><Input type='number' value={form.phone} maxlength={11} placeholder='中国大陆手机号' onInput={(event) => setField('phone', String(event.detail.value))} /></View>
        <Picker mode='region' value={[form.province, form.city, form.district]} onChange={(event) => {
          const [province, city, district] = event.detail.value as string[]
          setForm((current) => ({ ...current, province, city, district }))
        }}>
          <View className='form-field region-field'><Text>所在地区</Text><View className='region-value'><Text>{form.province ? `${form.province} ${form.city} ${form.district}` : '请选择省 / 市 / 区'}</Text><IconFont name='chevronRight' /></View></View>
        </Picker>
        <View className='form-field detail-field'><Text>详细地址</Text><Input value={form.detail} maxlength={100} placeholder='街道、楼牌号等' onInput={(event) => setField('detail', String(event.detail.value))} /></View>
        <View className='form-field'><Text>邮政编码</Text><Input type='number' value={form.postal_code} maxlength={12} placeholder='选填' onInput={(event) => setField('postal_code', String(event.detail.value))} /></View>
        <View className='default-row'><View><Text>设为默认地址</Text><Text>结算时优先使用此地址</Text></View><Switch color='#7A2630' checked={form.is_default} onChange={(event) => setField('is_default', event.detail.value)} /></View>
      </View>
      <Button className='save-address' loading={saving} disabled={saving} hoverClass='button-press' onClick={save}>保存地址</Button>
      {id > 0 && <Button className='delete-address' onClick={remove}>删除此地址</Button>}
    </View>
  )
}
