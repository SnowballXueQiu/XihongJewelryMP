import { Text } from '@tarojs/components'

const glyphs = {
  home: '\ue76f',
  products: '\ue7ab',
  profile: '\ue7d6',
  cart: '\ue782',
  search: '\ue726',
  close: '\ue781',
  chevronRight: '\ue71e',
  chevronDown: '\ue6d1',
  wallet: '\ue73b',
  order: '\ue711',
  package: '\ue7ab',
  shipping: '\ue7d4',
  service: '\ue78d',
  heart: '\ue7c4',
  heartFilled: '\ue7c0',
  location: '\ue704',
  plus: '\ue6c6',
  minus: '\ue603',
  success: '\ue7f4',
  refresh: '\ue71d',
  filter: '\ue6f6',
  gift: '\ue6f4',
  info: '\ue7d9'
} as const

export type IconName = keyof typeof glyphs

interface IconFontProps {
  name: IconName
  className?: string
}

export default function IconFont({ name, className = '' }: IconFontProps) {
  return <Text className={`xh-icon ${className}`}>{glyphs[name]}</Text>
}
