export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/products/index',
    'pages/profile/index',
    'pages/product-detail/index',
    'pages/cart/index',
    'pages/order-confirm/index',
    'pages/ar-try-on/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#2F2F2D',
    navigationBarTitleText: '玺鸿珠宝',
    navigationBarTextStyle: 'white',
    backgroundColor: '#F7F2EA'
  },
  tabBar: {
    color: '#7A746B',
    selectedColor: '#B89A63',
    backgroundColor: '#FFFDF8',
    borderStyle: 'black',
    list: [
      { pagePath: 'pages/home/index', text: '首页' },
      { pagePath: 'pages/products/index', text: '商品' },
      { pagePath: 'pages/profile/index', text: '个人' }
    ]
  },
  lazyCodeLoading: 'requiredComponents'
})
