package com.xihong.jewelry.controller

import com.xihong.jewelry.service.WechatMessageService
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/wechat/miniprogram/message-push")
class WechatMessageController(private val messages: WechatMessageService) {
    @GetMapping(produces = [MediaType.TEXT_PLAIN_VALUE])
    fun handshake(
        @RequestParam timestamp: String,
        @RequestParam nonce: String,
        @RequestParam echostr: String,
        @RequestParam(required = false) signature: String?,
        @RequestParam(name = "msg_signature", required = false) messageSignature: String?,
        @RequestParam(name = "encrypt_type", required = false) encryptType: String?,
    ): ResponseEntity<String> = runCatching {
        if (encryptType == "aes" || !messageSignature.isNullOrBlank()) {
            messages.verifyEncryptedSignature(requireNotNull(messageSignature), timestamp, nonce, echostr)
            messages.decrypt(echostr)
        } else {
            messages.verifyPlainSignature(requireNotNull(signature), timestamp, nonce)
            echostr
        }
    }.fold(
        onSuccess = { ResponseEntity.ok(it) },
        onFailure = { ResponseEntity.status(HttpStatus.FORBIDDEN).body("forbidden") },
    )

    @PostMapping(consumes = [MediaType.ALL_VALUE], produces = [MediaType.TEXT_PLAIN_VALUE])
    fun callback(
        request: HttpServletRequest,
        @RequestBody body: String,
        @RequestParam timestamp: String,
        @RequestParam nonce: String,
        @Suppress("UNUSED_PARAMETER") @RequestParam(required = false) signature: String?,
        @RequestParam(name = "msg_signature", required = false) messageSignature: String?,
        @RequestParam(name = "encrypt_type", required = false) encryptType: String?,
    ): ResponseEntity<String> {
        val payload = runCatching {
            require(encryptType == "aes") { "微信消息回调仅接受安全模式" }
            require(!messageSignature.isNullOrBlank()) { "微信安全模式回调缺少 msg_signature" }
            val encrypted = messages.extractEncrypted(body)
            messages.verifyEncryptedSignature(messageSignature, timestamp, nonce, encrypted)
            messages.decrypt(encrypted)
        }.getOrElse {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body("forbidden")
        }
        val requestId = request.getHeader("Request-ID") ?: request.getHeader("Wechatpay-Request-Id") ?: ""
        return if (messages.acceptAndProcess(payload, requestId)) {
            ResponseEntity.ok("success")
        } else {
            ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("fail")
        }
    }
}
