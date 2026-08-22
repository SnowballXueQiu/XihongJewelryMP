package com.xihong.jewelry.service

import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

/**
 * WeChat Pay/API timestamps use the second-precision RFC3339 form shown in the
 * official API examples. OffsetDateTime's default formatter preserves
 * nanoseconds, which WeChat rejects for fields such as time_expire.
 */
internal fun OffsetDateTime.toWechatRfc3339(): String =
    truncatedTo(ChronoUnit.SECONDS).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
