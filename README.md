# 玺鸿珠宝商城

天津玺鸿珠宝贸易有限公司的微信小程序商城、Kotlin/Spring Boot 业务后端与 Next.js 运营后台。商城主链路包括商品发现、搜索筛选、收藏、购物车、地址、优惠券、下单、微信支付、订单履约、物流、确认收货、退款与微信电子发票。

## 项目结构

- `src/miniprogram`：Taro 4 + React + TypeScript 微信小程序
- `src/backend`：Kotlin 2 + Spring Boot 4、JPA、Flyway，提供商城、管理后台和微信支付 API
- `src/backstage`：Next.js 运营后台

本次商城开发不包含 AR 预览功能；仓库中原有 AR 文件保持独立，不属于商城验收范围。

## 本地开发

需要 Node.js、pnpm 10、JDK 21、Gradle 9、Docker（推荐 OrbStack）和微信开发者工具。

```bash
pnpm install
cp .env.template .env
# 补齐随机密钥、微信参数和证书后启动完整依赖
docker compose up --build
```

- 后端：`http://127.0.0.1:8000`
- 管理后台：`http://127.0.0.1:3001`
- 小程序：使用微信开发者工具打开 `src/miniprogram`，或导入 `src/miniprogram/dist`
- 后台没有固定账号或默认密码；首次启动使用本地 `.env` 中的 `ADMIN_BOOTSTRAP_EMAIL` 与 `ADMIN_BOOTSTRAP_PASSWORD` 创建初始超级管理员。

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
WX_PAY_MOCK=false
ALLOW_MOCK_USER=false
USER_TOKEN_SECRET=<随机长密钥>
ADMIN_JWT_SECRET=<另一随机长密钥>
```

支付流程为：服务端创建 JSAPI 预支付单，并在请求中按 `PUBLIC_BASE_URL` 携带支付通知地址 → 小程序 `Taro.requestPayment` → 服务端验签并解密支付通知 → 小程序主动查询服务端结果。客户端返回成功不会直接把订单置为已支付。回调校验商户、AppID、金额和签名，并以通知 ID 幂等处理重复通知。退款请求同样由后端动态携带退款通知地址，最终状态由微信退款通知和主动查单共同确认，无需在平台预先配置这两个 URL。

订单创建携带客户端幂等键，支付取消或失败后会保留原订单并回到订单中心重试，不会重复扣库存或生成新订单号。后台发货时会把最终成功支付流水对应的快递/自提信息同步至微信小程序订单发货管理；微信通知跳转路径应配置为 `pages/orders/index`。

珠宝等实物商品的生产订单以微信小程序订单发货管理状态为准：后台仅录入运单号，服务端通过微信物流助手识别官方运力、订阅轨迹并上传发货；测试订单调用 `opspecialorder(type=2)`，不伪造运单。用户确认收货时只打开微信 `weappOrderConfirm`，返回后服务端查询微信订单状态，小程序不再本地二次完成。消息推送与定时对账会继续同步自动确认、退款和物流状态。

电子发票只允许在微信确认收货后申请。服务端获取微信官方抬头填写小程序链接，小程序跳转至微信页面复用个人/企业抬头；后台只处理真实开票申请、上传电子发票 PDF 并在最终交付前二次确认，交付后主动查询微信状态，不依赖发票回调，也不在结算页自建或重复填写抬头。

单独准备的本地开发 `.env` 可将 `WX_PAY_MOCK=true` 以显示清晰的“模拟支付”确认框；`.env.template` 默认关闭模拟支付与模拟用户。生产环境缺少证书或商户参数时，应用会明确失败，不会伪造支付成功。

上线前还需在微信公众平台配置：

- request 合法域名（必须为已备案 HTTPS 域名）
- 小程序 AppID 与商户号绑定关系
- JSAPI 支付权限、APIv3 密钥、商户私钥和微信支付公钥
- `PUBLIC_BASE_URL` 公网 HTTPS 可达；后端会在支付/退款请求中分别携带 `/payments/wechat/notify` 与 `/payments/wechat/refund-notify`
- 小程序已接入“订单发货管理”，商户完成发货结算规则确认
- 小程序“消息推送”URL 配置为 `https://api.xihongzhubao.com/wechat/miniprogram/message-push`，数据格式选择 JSON，消息加密方式选择“安全模式”，Token 与 EncodingAESKey 和服务器环境一致
- 商户已开通微信电子发票自建/第三方能力；本系统使用同步响应与主动查询，不配置发票回调

## 验证

```bash
pnpm build:miniprogram
pnpm --dir src/backstage lint
pnpm build:backstage
gradle -p src/backend test
docker compose config --quiet
```

后端测试使用独立临时数据库，不会修改本地开发数据。生产部署前把 `src/miniprogram/project.config.json` 中的域名校验恢复为开启，并在真实商户沙箱/小额订单中完成支付、重复回调、主动查询、取消、退款和退款回调验证。

## 生产部署提示

根目录 `compose.yaml` 会部署 Kotlin 后端、PostgreSQL、Redis、管理后台、AR H5 和反向代理。容器日志默认按单文件 10MB、保留 5 个文件轮转；可通过 `DOCKER_LOG_MAX_SIZE` 与 `DOCKER_LOG_MAX_FILE` 调整。Nginx 与 Spring 的单次请求上限统一为 16MB。

### 微信支付证书最小权限

证书文件只能通过只读 volume 挂载，不能提交到 Git，也不能把商户私钥改成 `0644` 或其他全局可读权限。容器内后端始终以 `app` 用户运行，并通过 `WX_PAY_CERT_GID` 指定的补充组读取证书。以下示例中的 `10001` 只是部署专用组号，不是任何真实商户信息；生产服务器可换成尚未占用的 GID，但 `.env` 与宿主机目录必须一致。

```bash
# 在 Linux Docker 宿主机执行；源文件路径由部署人员替换
sudo install -d -o root -g 10001 -m 0750 /opt/xihong/secrets/wechatpay
sudo install -o root -g 10001 -m 0640 /secure-source/apiclient_key.pem /opt/xihong/secrets/wechatpay/apiclient_key.pem
sudo install -o root -g 10001 -m 0640 /secure-source/pub_key.pem /opt/xihong/secrets/wechatpay/pub_key.pem

# .env
WX_PAY_CERT_DIR=/opt/xihong/secrets/wechatpay
WX_PAY_CERT_GID=10001

# 展开配置后，以容器 app 用户验证只读权限；不打印密钥内容
docker compose config --quiet
docker compose run --rm --no-deps --entrypoint sh backend -c \
  'test -r "$WX_PAY_PRIVATE_KEY_PATH" && test -r "$WX_PAY_PUBLIC_KEY_PATH" && test ! -w "$WX_PAY_PRIVATE_KEY_PATH"'
```

后端入口会在启动 JVM 前校验证书存在、`app` 用户可读，并拒绝启动对 `other` 开放权限的商户私钥。宿主机轮换证书后应重新执行权限检查并重启后端。

### 上线前备份与迁移演练

旧版 `backend_data` SQLite 卷只读挂载到 `/legacy`；首次启动且 PostgreSQL 为空时，后端会迁移兼容数据并保留原卷以便回滚。不要在唯一一份生产数据上首次验证迁移。每次发布前至少完成下面的备份，并把备份复制到 Docker 宿主机之外的加密存储：

```bash
backup_dir="backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"

# PostgreSQL 一致性备份，并验证归档可读取
docker compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_dir/postgres.dump"
docker run --rm -i postgres:17-alpine pg_restore --list \
  < "$backup_dir/postgres.dump" >/dev/null

# 上传文件与旧 SQLite 冷备（旧库不存在时应先确认本次部署是否无需迁移）
docker compose cp backend:/app/uploads "$backup_dir/uploads"
docker compose cp backend:/legacy/xihong.sqlite3 "$backup_dir/xihong.sqlite3"
```

迁移演练必须在隔离的临时/预发布 PostgreSQL 上进行：恢复最新 `postgres.dump`，使用与生产发布完全相同的后端镜像启动一次，确认 `flyway_schema_history` 全部成功，并核对订单、支付、退款、优惠券、库存和回调收件箱的关键数量。确认演练可重复、应用健康检查通过、回滚镜像能读取迁移后的数据库后，才允许迁移生产。切换前再次生成备份，发布期间不要手工修改 Flyway 表或重写已执行的迁移文件。

### 构建、健康与 TLS 检查

```bash
# 配置和镜像必须在目标架构上通过
docker compose config --quiet
docker compose build backend backstage ar_h5

# 启动后所有服务都应为 running/healthy；再验证三个公网入口
docker compose up -d
docker compose ps
curl --fail --silent --show-error https://api.xihongzhubao.com/health
curl --fail --silent --show-error https://xihongzhubao.com/ >/dev/null
curl --fail --silent --show-error https://ar.xihongzhubao.com/ >/dev/null

# 证书剩余不足 30 天时命令失败；三个域名都要检查
for host in api.xihongzhubao.com xihongzhubao.com ar.xihongzhubao.com; do
  echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null \
    | openssl x509 -noout -checkend 2592000 || exit 1
done
```

生产 TLS 可以由宿主机反向代理或云负载均衡终止；无论使用哪种方式，都必须把 80 端口重定向到 HTTPS、保留 `X-Forwarded-Proto`，并为 TLS 到期检查配置监控告警。微信支付、退款、发票与小程序消息回调 URL 必须从公网 HTTPS 直接访问且不能要求登录。
