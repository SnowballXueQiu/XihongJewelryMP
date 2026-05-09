Component({
  properties: {
    modelUrl: {
      type: String,
      value: ''
    },
    modelScale: {
      type: String,
      value: '0.2 0.2 0.2'
    },
    modelRotation: {
      type: String,
      value: '0 0 0'
    },
    modelPosition: {
      type: String,
      value: '0 0.05 0'
    },
    autoSync: {
      type: Number,
      value: 9
    }
  },
  data: {
    arReady: false,
    assetsLoaded: false,
    progress: 0
  },
  methods: {
    handleReady(event) {
      this.scene = event.detail.value
      this.triggerEvent('scene-ready')
    },
    handleARReady() {
      this.setData({ arReady: true })
      this.triggerEvent('ar-ready')
    },
    handleARError(event) {
      this.triggerEvent('ar-error', event.detail)
    },
    handleAssetsProgress(event) {
      this.setData({ progress: event.detail.value || 0 })
      this.triggerEvent('asset-progress', event.detail)
    },
    handleAssetsLoaded() {
      this.setData({ assetsLoaded: true })
      this.triggerEvent('asset-loaded')
    }
  }
})
