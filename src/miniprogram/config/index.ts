import { defineConfig } from '@tarojs/cli'
import path from 'path'

export default defineConfig(async (merge) => {
  const baseConfig = {
    projectName: 'XihongJewelryMP',
    date: '2026-05-09',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      828: 1.81 / 2
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    plugins: ['@tarojs/plugin-framework-react'],
    defineConstants: {},
    copy: {
      patterns: [],
      options: {}
    },
    framework: 'react',
    compiler: 'webpack5',
    cache: {
      enable: true
    },
    alias: {
      '@': path.resolve(__dirname, '..', 'src')
    },
    cssMinimizer: 'csso',
    terser: {
      enable: false
    },
    csso: {
      enable: true
    },
    mini: {
      webpackChain(chain: any) {
        chain.performance.hints(false)
        chain.performance.maxAssetSize(2 * 1000 * 1000)
        chain.performance.maxEntrypointSize(2 * 1000 * 1000)
      },
      postcss: {
        pxtransform: {
          enable: true,
          config: {}
        },
        cssModules: {
          enable: false,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]'
          }
        }
      }
    },
    h5: {}
  }

  if (process.env.NODE_ENV === 'production') {
    return merge({}, baseConfig, {
      mini: {
        optimizeMainPackage: {
          enable: true
        }
      }
    })
  }

  return baseConfig
})
