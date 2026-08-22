import { useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { Button, Input, Text, View } from '@tarojs/components'
import { createInvoiceTitle, deleteInvoiceTitle, fetchInvoiceTitles, updateInvoiceTitle } from '@/services/api'
import { InvoiceTitle, InvoiceTitlePayload } from '@/types/domain'
import IconFont from '@/components/IconFont'
import LuxuryLoader from '@/components/LuxuryLoader'
import './index.scss'

const emptyEditor: InvoiceTitlePayload = {
  invoice_type: 'personal', title: '个人', tax_number: '', email: '', is_default: false
}

export default function InvoiceTitlesPage() {
  const router = useRouter()
  const selecting = router.params.select === '1'
  const requestedType = router.params.type === 'company' ? 'company' : router.params.type === 'personal' ? 'personal' : ''
  const [titles, setTitles] = useState<InvoiceTitle[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editor, setEditor] = useState<InvoiceTitlePayload>(emptyEditor)
  const [editorOpen, setEditorOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try { setTitles(await fetchInvoiceTitles()) } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '抬头加载失败', icon: 'none' })
    } finally { setLoading(false) }
  }

  useDidShow(() => { load() })

  function choose(title: InvoiceTitle) {
    if (!selecting) return
    Taro.setStorageSync('selected_invoice_title_id', title.id)
    Taro.navigateBack()
  }

  function openEditor(title?: InvoiceTitle) {
    setEditingId(title?.id || null)
    setEditor(title ? {
      invoice_type: title.invoice_type, title: title.title, tax_number: title.tax_number,
      email: title.email, is_default: title.is_default
    } : { ...emptyEditor, invoice_type: requestedType || 'personal', title: requestedType === 'company' ? '' : '个人' })
    setEditorOpen(true)
  }

  async function save() {
    if (!editor.title.trim()) return Taro.showToast({ title: '请填写发票抬头', icon: 'none' })
    if (editor.invoice_type === 'company' && !editor.tax_number.trim()) return Taro.showToast({ title: '请填写纳税人识别号', icon: 'none' })
    setSaving(true)
    try {
      const payload = { ...editor, title: editor.title.trim(), tax_number: editor.tax_number.trim(), email: editor.email.trim() }
      const saved = editingId ? await updateInvoiceTitle(editingId, payload) : await createInvoiceTitle(payload)
      setEditorOpen(false)
      await load()
      Taro.showToast({ title: '发票抬头已保存', icon: 'success' })
      if (selecting) choose(saved)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' })
    } finally { setSaving(false) }
  }

  async function importFromWechat() {
    try {
      const result = await Taro.chooseInvoiceTitle()
      const invoiceType = String(result.type) === '0' ? 'company' : 'personal'
      const existing = titles.find((item) => item.invoice_type === invoiceType && item.title === result.title && item.tax_number === (result.taxNumber || ''))
      const saved = existing || await createInvoiceTitle({
        invoice_type: invoiceType,
        title: result.title || (invoiceType === 'personal' ? '个人' : ''),
        tax_number: result.taxNumber || '',
        email: '',
        is_default: titles.length === 0
      })
      await load()
      Taro.showToast({ title: existing ? '已选择微信抬头' : '微信抬头已保存', icon: 'success' })
      if (selecting) choose(saved)
    } catch (error) {
      const message = String((error as { errMsg?: string })?.errMsg || '')
      if (!message.includes('cancel')) Taro.showToast({ title: '暂时无法读取微信抬头，可手动新增', icon: 'none' })
    }
  }

  async function remove(title: InvoiceTitle) {
    const modal = await Taro.showModal({ title: '删除发票抬头', content: `确定删除“${title.title}”吗？`, confirmColor: '#74252D' })
    if (!modal.confirm) return
    try { await deleteInvoiceTitle(title.id); await load() } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '删除失败', icon: 'none' })
    }
  }

  const visibleTitles = requestedType ? titles.filter((title) => title.invoice_type === requestedType) : titles

  return <View className='page invoice-book-page'>
    <View className='invoice-book-head'><Text>INVOICE PROFILE</Text><Text>{selecting ? '选择发票抬头' : '发票抬头簿'}</Text><Text>常用信息只需保存一次，结算时一键选择。</Text></View>
    <View className='invoice-book-actions'>
      <Button onClick={importFromWechat}>从微信导入</Button>
      <Button className='primary' onClick={() => openEditor()}><IconFont name='plus' />新增抬头</Button>
    </View>
    {loading ? <LuxuryLoader label='正在读取发票抬头' /> : visibleTitles.length ? <View className='invoice-title-list'>
      {visibleTitles.map((title, index) => <View className='invoice-title-card' key={title.id} onClick={() => choose(title)}>
        <View className='invoice-title-number'><Text>{String(index + 1).padStart(2, '0')}</Text><Text>{title.invoice_type === 'company' ? '企业' : '个人'}</Text></View>
        <View className='invoice-title-copy'><View><Text>{title.title}</Text>{title.is_default && <Text className='default-tag'>默认</Text>}</View>{title.invoice_type === 'company' && <Text>税号 {title.tax_number}</Text>}{title.email && <Text>{title.email}</Text>}</View>
        <View className='invoice-title-ops'><Button onClick={(event) => { event.stopPropagation(); openEditor(title) }}>编辑</Button><Button onClick={(event) => { event.stopPropagation(); remove(title) }}>删除</Button></View>
      </View>)}
    </View> : <View className='invoice-book-empty'><Text>还没有可用抬头</Text><Text>新增个人或企业抬头，之后结算无需重复填写。</Text></View>}

    {editorOpen && <View className='invoice-editor-mask' onClick={() => setEditorOpen(false)}><View className='invoice-editor' onClick={(event) => event.stopPropagation()}>
      <View className='editor-head'><View><Text>INVOICE DETAILS</Text><Text>{editingId ? '编辑发票抬头' : '新增发票抬头'}</Text></View><Button onClick={() => setEditorOpen(false)}>关闭</Button></View>
      <View className='editor-types'><Button className={editor.invoice_type === 'personal' ? 'active' : ''} onClick={() => setEditor({ ...editor, invoice_type: 'personal', title: editor.title || '个人', tax_number: '' })}>个人</Button><Button className={editor.invoice_type === 'company' ? 'active' : ''} onClick={() => setEditor({ ...editor, invoice_type: 'company', title: editor.title === '个人' ? '' : editor.title })}>企业</Button></View>
      <View className='editor-field'><Text>发票抬头</Text><Input value={editor.title} placeholder={editor.invoice_type === 'company' ? '企业完整名称' : '个人'} onInput={(event) => setEditor({ ...editor, title: String(event.detail.value) })} /></View>
      {editor.invoice_type === 'company' && <View className='editor-field'><Text>纳税人识别号</Text><Input value={editor.tax_number} placeholder='请输入企业税号' onInput={(event) => setEditor({ ...editor, tax_number: String(event.detail.value) })} /></View>}
      <View className='editor-field'><Text>接收邮箱</Text><Input value={editor.email} placeholder='选填，用于接收电子发票' onInput={(event) => setEditor({ ...editor, email: String(event.detail.value) })} /></View>
      <Button className={editor.is_default ? 'default-switch active' : 'default-switch'} onClick={() => setEditor({ ...editor, is_default: !editor.is_default })}><View /><Text>{editor.is_default ? '已设为默认抬头' : '设为默认抬头'}</Text></Button>
      <Button className='save-title' loading={saving} disabled={saving} onClick={save}>保存发票抬头</Button>
    </View></View>}
  </View>
}
