export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/products/index',
    'pages/profile/index',
    'pages/product-detail/index',
    'pages/cart/index',
    'pages/order-confirm/index',
    'pages/orders/index',
    'pages/order-detail/index',
    'pages/payment-result/index',
    'pages/addresses/index',
    'pages/address-edit/index',
    'pages/favorites/index',
    'pages/coupons/index',
    'pages/ar-try-on/index',
    'pages/ar-mediapipe/index'
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
      { pagePath: 'pages/home/index', text: '首页', iconPath: 'assets/tabbar/home.png', selectedIconPath: 'assets/tabbar/home-active.png' },
      { pagePath: 'pages/products/index', text: '商品', iconPath: 'assets/tabbar/products.png', selectedIconPath: 'assets/tabbar/products-active.png' },
      { pagePath: 'pages/profile/index', text: '个人', iconPath: 'assets/tabbar/profile.png', selectedIconPath: 'assets/tabbar/profile-active.png' }
    ]
  },
  lazyCodeLoading: 'requiredComponents'
})
