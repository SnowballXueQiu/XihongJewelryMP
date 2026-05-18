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
      value: 11,
      observer(newVal) {
        console.log('[xr-try-on] autoSync changed to:', newVal)
        this.setData({ activeFinger: newVal })
      }
    }
  },
  data: {
    arReady: false,
    assetsLoaded: false,
    activeFinger: 11,
    progress: 0
  },
  lifetimes: {
    attached() {
      this.setData({ activeFinger: this.data.autoSync })
    }
  },
  methods: {
    handleReady(event) {
      this.scene = event.detail.value
      this.triggerEvent('scene-ready')
    },
    handleARReady() {
      console.log('[xr-try-on] AR ready, activeFinger:', this.data.activeFinger)
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
    },
    handleTrackerSwitch(event) {
      console.log('[xr-try-on] tracker switch:', event.detail.value)
    }
  }
})
