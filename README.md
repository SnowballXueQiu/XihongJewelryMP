# 玺鸿珠宝微信小程序 MVP

天津玺鸿珠宝贸易有限公司 / Xihong Jewelry & Gold Trading Co., Ltd

pnpm monorepo，包含 Taro 微信小程序与 FastAPI 后端。

## 结构

- `src/miniprogram`: Taro React + TypeScript + Sass 微信小程序
- `src/backend`: FastAPI + SQLModel + SQLite，使用 `uv sync`

## 命令

```bash
pnpm install
pnpm install:backend
pnpm dev
pnpm build
```

`pnpm dev` 同时启动后端热重载与 Taro 小程序 watch；后端默认地址为 `http://127.0.0.1:8000`。

生产/上传前使用 `pnpm build`，Taro 构建会压缩 CSS 并开启主包优化；微信开发者工具上传阶段会按 `project.config.json` 的 `setting.minified=true` 自动压缩脚本。不要开启 Taro 的 WXML/XML 压缩，Taro 的 `base.wxml` 里包含需要闭合的原生组件模板，压缩会导致微信开发者工具报 `expect end-tag input`。不要开启 Taro Terser JS 压缩，真机会在 React/Taro runtime 初始化时触发 `Maximum call stack size exceeded`。

微信开发者工具预览时，先运行：

```bash
pnpm --dir src/miniprogram dev:weapp
```

然后打开 `src/miniprogram/dist`。

当前小程序 AppID 已配置为 `wx8469c45d32e0a628`，每次 `pnpm build` 都会同步到 `dist/project.config.json`。

## AR 模型

商品支持以下 AR 字段：

- `ar_model_url`: `.glb` 或 `.gltf` 地址
- `ar_scale`: xr-frame scale，例如 `0.22 0.22 0.22`
- `ar_rotation`: xr-frame rotation，例如 `0 0 0`
- `ar_position`: xr-frame position，例如 `0 0.08 0`
- `ar_auto_sync`: xr-frame Hand 追踪点，戒指默认 `9`

真实上线前请提供低面数 GLB 模型及每个商品的试戴参数。
