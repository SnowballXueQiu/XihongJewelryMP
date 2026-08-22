package com.xihong.jewelry

import com.xihong.jewelry.config.AppProperties
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.boot.runApplication
import org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration
import org.springframework.scheduling.annotation.EnableScheduling

@SpringBootApplication(exclude = [UserDetailsServiceAutoConfiguration::class])
@EnableScheduling
@EnableConfigurationProperties(AppProperties::class)
class XihongApplication

fun main(args: Array<String>) {
    runApplication<XihongApplication>(*args)
}
