# 玺鸿珠宝商城

天津玺鸿珠宝贸易有限公司的微信小程序商城、FastAPI 业务后端与 Next.js 运营后台。商城主链路包括商品发现、搜索筛选、收藏、购物车、地址、优惠券、下单、微信支付、订单履约、物流、确认收货与退款。

## 项目结构

- `src/miniprogram`：Taro 4 + React + TypeScript 微信小程序
- `src/backend`：FastAPI + SQLModel，提供商城、管理后台和微信支付 API
- `src/backstage`：Next.js 运营后台

本次商城开发不包含 AR 预览功能；仓库中原有 AR 文件保持独立，不属于商城验收范围。

## 本地开发

需要 Node.js、pnpm 10、Python 3.12+、uv 和微信开发者工具。

```bash
pnpm install
cp src/backend/.env.example src/backend/.env
pnpm dev
```

- 后端：`http://127.0.0.1:8000`
- 管理后台：`http://127.0.0.1:3001`
- 小程序：使用微信开发者工具打开 `src/miniprogram`，或导入 `src/miniprogram/dist`
- 本地默认后台账号仅供开发：`admin@xihong.local` / `XihongAdmin123!`

小程序开发构建默认访问本地 API；生产构建默认访问 `https://api.xihongzhubao.com`。可显式覆盖：

```bash
TARO_APP_API_BASE=https://your-api.example.com pnpm build:miniprogram
```

## 微信支付 v3

后端严格区分真实支付与本地模拟。生产环境必须设置：

```dotenv
WECHAT_APPID=
WECHAT_APP_SECRET=
WX_PAY_APPID=
WX_PAY_MCH_ID=
WX_PAY_API_V3_KEY=
WX_PAY_SERIAL_NO=
WX_PAY_CERT_DIR=/absolute/host/path/to/wechatpay-certificates
WX_PAY_PRIVATE_KEY_PATH=/run/secrets/wechatpay/apiclient_key.pem
WX_PAY_PUBLIC_KEY_ID=
WX_PAY_PUBLIC_KEY_PATH=/run/secrets/wechatpay/pub_key.pem
WX_PAY_NOTIFY_URL=https://your-api.example.com/api/payments/wechat/notify
WX_PAY_REFUND_NOTIFY_URL=https://your-api.example.com/api/payments/wechat/refund-notify
WX_PAY_INVOICE_NOTIFY_URL=https://your-api.example.com/api/payments/wechat/invoice-notify
INVOICE_CARD_APPID=<插入发票卡券所用的公众号AppID>
INVOICE_CARD_LOGO_URL=<微信可访问的HTTPS卡券Logo地址>
WX_PAY_MOCK=false
ALLOW_MOCK_USER=false
USER_TOKEN_SECRET=<随机长密钥>
ADMIN_JWT_SECRET=<另一随机长密钥>
```

支付流程为：服务端创建 JSAPI 预支付单 → 小程序 `Taro.requestPayment` → 服务端验签并解密支付通知 → 小程序主动查询服务端结果。客户端返回成功不会直接把订单置为已支付。回调校验商户、AppID、金额和签名，并以幂等方式处理重复通知。退款由后台发起并通过独立退款通知确认。

订单创建携带客户端幂等键，支付取消或失败后会保留原订单并回到订单中心重试，不会重复扣库存或生成新订单号。后台发货时会把最终成功支付流水对应的快递/自提信息同步至微信小程序订单发货管理；微信通知跳转路径应配置为 `pages/orders/index`。

珠宝等实物商品的生产订单以微信小程序订单发货管理状态为准：后台发货会调用平台发货接口，订单完成前会再次查询平台确认收货状态，不能在微信未确认收货时提前完成。电子发票不再维护本地发票抬头；支付下单通过 `support_fapiao` 展示微信支付凭证开票入口，用户在微信填写个人/企业抬头，后台只同步微信抬头、上传真实 PDF 并调用微信接口插入卡包。

本地 `.env.example` 中 `WX_PAY_MOCK=true` 会显示清晰的“模拟支付”确认框；生产模板默认关闭。生产环境缺少证书或商户参数时，接口会明确失败，不会伪造支付成功。

上线前还需在微信公众平台配置：

- request 合法域名（必须为已备案 HTTPS 域名）
- 小程序 AppID 与商户号绑定关系
- JSAPI 支付权限、APIv3 密钥、商户私钥和微信支付公钥
- 支付/退款通知公网 HTTPS 可达，且不能要求登录
- 小程序已接入“订单发货管理”，商户完成发货结算规则确认
- 商户已开通微信电子发票自建/第三方能力，并配置发票回调、插卡公众号 AppID 与卡券 Logo

## 验证

```bash
pnpm build:miniprogram
pnpm --dir src/backstage lint
pnpm build:backstage
pnpm test:backend
```

后端测试使用独立临时数据库，不会修改本地开发数据。生产部署前把 `src/miniprogram/project.config.json` 中的域名校验恢复为开启，并在真实商户沙箱/小额订单中完成支付、重复回调、主动查询、取消、退款和退款回调验证。

## 生产部署提示

根目录 `compose.yaml` 可部署后端和管理后台。证书文件应通过只读 secret/volume 挂载，不能提交到 Git。反向代理必须在公网使用 HTTPS；修改后台初始密码、两类签名密钥，并将 SQLite 持久卷纳入备份。高并发或多实例部署建议把数据库迁移到 PostgreSQL，并加入正式迁移工具。
