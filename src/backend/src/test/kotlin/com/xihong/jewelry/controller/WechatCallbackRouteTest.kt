package com.xihong.jewelry.controller

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertEquals
import org.springframework.web.bind.annotation.RequestMapping

class WechatCallbackRouteTest {
    @Test
    fun `message push exposes only the canonical route`() {
        assertEquals(
            setOf("/wechat/miniprogram/message-push"),
            routesOf(WechatMessageController::class.java),
        )
    }

    @Test
    fun `payment callbacks expose only the canonical route`() {
        assertEquals(
            setOf("/payments/wechat"),
            routesOf(WechatPayCallbackController::class.java),
        )
    }

    private fun routesOf(type: Class<*>): Set<String> =
        type.getAnnotation(RequestMapping::class.java).value.toSet()
}
