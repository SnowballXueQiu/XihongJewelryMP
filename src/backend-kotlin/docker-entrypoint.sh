#!/bin/sh
set -eu

private_key="${WX_PAY_PRIVATE_KEY_PATH:-/run/secrets/wechatpay/apiclient_key.pem}"
public_key="${WX_PAY_PUBLIC_KEY_PATH:-/run/secrets/wechatpay/pub_key.pem}"

for key_file in "$private_key" "$public_key"; do
  if [ ! -f "$key_file" ] || [ ! -r "$key_file" ]; then
    echo "微信支付证书文件不存在或 app 用户不可读：$key_file" >&2
    echo "请检查 WX_PAY_CERT_DIR、WX_PAY_CERT_GID 以及宿主机目录/文件组权限。" >&2
    exit 78
  fi
done

private_mode="$(stat -c '%a' "$private_key")"
case "$private_mode" in
  *[1-7])
    echo "拒绝启动：微信支付商户私钥禁止向 other 用户开放权限（当前 mode=$private_mode）。" >&2
    exit 78
    ;;
esac

exec java -XX:MaxRAMPercentage=75 -jar /app/app.jar
