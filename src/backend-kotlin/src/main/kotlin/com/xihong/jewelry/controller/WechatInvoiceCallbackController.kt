package com.xihong.jewelry.controller

import com.xihong.jewelry.service.WechatCallbackHeaders
import com.xihong.jewelry.service.WechatCallbackRejectedException
import com.xihong.jewelry.service.WechatInvoiceService
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/payments/wechat")
class WechatInvoiceCallbackController(private val invoices: WechatInvoiceService) {
    private val log = LoggerFactory.getLogger(javaClass)

    @PostMapping("/invoice-notify", consumes = [MediaType.APPLICATION_JSON_VALUE])
    fun invoice(
        @RequestHeader(name = "Wechatpay-Serial", required = false) serial: String?,
        @RequestHeader(name = "Wechatpay-Signature", required = false) signature: String?,
        @RequestHeader(name = "Wechatpay-Timestamp", required = false) timestamp: String?,
        @RequestHeader(name = "Wechatpay-Nonce", required = false) nonce: String?,
        @RequestHeader(name = "Request-ID", required = false) requestId: String?,
        @RequestBody body: String,
    ): ResponseEntity<*> = try {
        if (serial.isNullOrBlank() || signature.isNullOrBlank() || timestamp.isNullOrBlank() || nonce.isNullOrBlank()) {
            throw WechatCallbackRejectedException("微信发票回调签名头不完整")
        }
        invoices.acceptNotification(
            WechatCallbackHeaders(serial, signature, timestamp, nonce, requestId.orEmpty()),
            body,
        )
        ResponseEntity.noContent().build<Void>()
    } catch (error: WechatCallbackRejectedException) {
        log.warn("Rejected WeChat invoice callback: {}", error.message)
        ResponseEntity.status(HttpStatus.BAD_REQUEST).body(WechatCallbackFailure("FAIL", "回调验签或数据校验失败"))
    } catch (error: Exception) {
        log.error("Failed to process WeChat invoice callback", error)
        ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(WechatCallbackFailure("FAIL", "回调处理失败"))
    }
}
