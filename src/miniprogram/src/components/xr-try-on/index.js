Component({
  options: {
    styleIsolation: 'shared'
  },
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
    },
    debugSkeleton: {
      type: Boolean,
      value: false
    }
  },
  data: {
    arReady: false,
    assetsLoaded: false,
    activeFinger: 11,
    progress: 0,
    viewportWidth: '100vw',
    viewportHeight: '100vh',
    viewportStyle: 'width:100vw;height:100vh;',
    debugPoints: []
  },
  lifetimes: {
    attached() {
      this.setData({ activeFinger: this.data.autoSync })
      const viewport = this.getViewport()
      this.setData({
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        viewportStyle: viewport.style,
        debugPoints: this.buildDebugPoints()
      })
    }
  },
  methods: {
    getViewport() {
      const windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const systemInfo = wx.getSystemInfoSync()
      const widthPx = Math.max(windowInfo.windowWidth || 0, systemInfo.windowWidth || 0, systemInfo.screenWidth || 0)
      const heightPx = Math.max(windowInfo.windowHeight || 0, systemInfo.windowHeight || 0, systemInfo.screenHeight || 0)
      const width = widthPx ? `${widthPx}px` : '100vw'
      const height = heightPx ? `${heightPx}px` : '100vh'
      return {
        width,
        height,
        style: `position:fixed;left:0;top:0;width:${width};height:${height};display:block;overflow:hidden;background:#000;`
      }
    },
    buildDebugPoints() {
      return Array.from({ length: 21 }, (_, index) => ({
        id: index,
        scale: index === 0 ? '0.006 0.006 0.006' : '0.004 0.004 0.004',
        uniforms: index === 0
          ? 'u_baseColorFactor:0.98 0.78 0.25 0.9'
          : 'u_baseColorFactor:0.95 0.86 0.64 0.78'
      }))
    },
    createVector() {
      if (!this.xrFrameSystem) return { x: 0, y: 0, z: 0 }
      return new this.xrFrameSystem.Vector3()
    },
    resolveTracker() {
      if (!this.scene || !this.scene.getElementById) return null
      const element = this.scene.getElementById('tracker')
      if (!element) return null
      if (typeof element.getPosition === 'function') return element
      if (this.xrFrameSystem && this.xrFrameSystem.ARTracker && typeof element.getComponent === 'function') {
        return element.getComponent(this.xrFrameSystem.ARTracker)
      }
      return null
    },
    readHandLandmarks() {
      if (!this.tracker || typeof this.tracker.getPosition !== 'function') return []

      return Array.from({ length: 21 }, (_, index) => {
        const vector = this.createVector()
        try {
          this.tracker.getPosition(index, vector, false)
          return {
            x: Number(vector.x || 0),
            y: Number(vector.y || 0),
            z: Number(vector.z || 0)
          }
        } catch (error) {
          return null
        }
      }).filter(Boolean)
    },
    handleReady(event) {
      this.scene = event.detail.value
      this.xrFrameSystem = wx.getXrFrameSystem ? wx.getXrFrameSystem() : null
      this.tracker = this.resolveTracker()
      this.triggerEvent('scene-ready')
    },
    handleARReady() {
      console.log('[xr-try-on] AR ready, activeFinger:', this.data.activeFinger)
      this.setData({ arReady: true })
      this.tracker = this.resolveTracker()
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
      this.triggerEvent('tracker-switch', event.detail)
    },
    handleTick() {
      if (!this.data.debugSkeleton) return
      if (!this.tracker) this.tracker = this.resolveTracker()
      const points = this.readHandLandmarks()
      this.triggerEvent('tracker-debug', {
        active: points.length === 21,
        points
      })
    }
  }
})
