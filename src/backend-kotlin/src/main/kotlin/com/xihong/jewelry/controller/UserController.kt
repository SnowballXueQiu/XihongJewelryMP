package com.xihong.jewelry.controller

import com.xihong.jewelry.domain.AddressEntity
import com.xihong.jewelry.domain.PetProfileEntity
import com.xihong.jewelry.domain.PointLedgerEntity
import com.xihong.jewelry.domain.UserEntity
import com.xihong.jewelry.repository.AddressRepository
import com.xihong.jewelry.repository.PetProfileRepository
import com.xihong.jewelry.repository.PointLedgerRepository
import com.xihong.jewelry.repository.UserRepository
import com.xihong.jewelry.security.TokenService
import com.xihong.jewelry.security.UserPrincipal
import com.xihong.jewelry.service.DomainMapper
import com.xihong.jewelry.service.WechatPlatformException
import com.xihong.jewelry.service.WechatPlatformService
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

@RestController
@RequestMapping("/api")
class UserController(
    private val users: UserRepository,
    private val addresses: AddressRepository,
    private val pets: PetProfileRepository,
    private val pointLedgers: PointLedgerRepository,
    private val tokens: TokenService,
    private val wechat: WechatPlatformService,
    private val mapper: DomainMapper,
) {
    @PostMapping("/auth/wechat")
    @Transactional
    fun login(@Valid @RequestBody payload: WechatLoginRequest): UserTokenDto {
        val openid = try {
            wechat.login(payload.code)
        } catch (error: WechatPlatformException) {
            throw ResponseStatusException(HttpStatus.BAD_GATEWAY, error.message, error)
        }
        val user = users.findByWechatOpenid(openid) ?: users.save(
            UserEntity(nickname = payload.nickname.trim().ifBlank { "微信用户" }, wechatOpenid = openid),
        )
        if (user.nickname.isBlank() || user.nickname == "微信用户") {
            user.nickname = payload.nickname.trim().ifBlank { "微信用户" }
            users.save(user)
        }
        if (pets.findByUserId(user.id!!) == null) pets.save(PetProfileEntity(userId = user.id!!))
        return UserTokenDto(tokens.userToken(user), user = mapper.user(user))
    }

    @GetMapping("/me")
    fun me(@AuthenticationPrincipal principal: UserPrincipal): UserDto = mapper.user(currentUser(principal))

    @PostMapping("/me/phone")
    @Transactional
    fun bindPhone(
        @AuthenticationPrincipal principal: UserPrincipal,
        @Valid @RequestBody payload: WechatPhoneRequest,
    ): UserDto {
        val user = currentUser(principal)
        user.phone = try {
            wechat.exchangePhone(payload.code)
        } catch (error: WechatPlatformException) {
            throw ResponseStatusException(HttpStatus.BAD_GATEWAY, error.message, error)
        }
        return mapper.user(users.save(user))
    }

    @GetMapping("/addresses")
    fun listAddresses(@AuthenticationPrincipal principal: UserPrincipal): List<AddressDto> =
        addresses.findAllByUserIdOrderByIsDefaultDescIdDesc(principal.id).map(mapper::address)

    @PostMapping("/addresses")
    @Transactional
    fun createAddress(
        @AuthenticationPrincipal principal: UserPrincipal,
        @Valid @RequestBody payload: AddressWrite,
    ): AddressDto {
        val current = addresses.findAllByUserIdOrderByIsDefaultDescIdDesc(principal.id)
        val makeDefault = payload.isDefault || current.isEmpty()
        if (makeDefault) current.filter { it.isDefault }.forEach { it.isDefault = false; it.updatedAt = Instant.now() }
        val entity = AddressEntity(userId = principal.id).applyWrite(payload, makeDefault)
        return mapper.address(addresses.save(entity))
    }

    @PutMapping("/addresses/{id}")
    @Transactional
    fun updateAddress(
        @AuthenticationPrincipal principal: UserPrincipal,
        @PathVariable id: Long,
        @Valid @RequestBody payload: AddressWrite,
    ): AddressDto {
        val entity = addresses.findByIdAndUserId(id, principal.id) ?: notFound("地址不存在")
        if (payload.isDefault) {
            addresses.findAllByUserIdOrderByIsDefaultDescIdDesc(principal.id)
                .filter { it.id != id && it.isDefault }
                .forEach { it.isDefault = false; it.updatedAt = Instant.now() }
        }
        entity.applyWrite(payload, payload.isDefault || entity.isDefault)
        return mapper.address(addresses.save(entity))
    }

    @DeleteMapping("/addresses/{id}")
    @Transactional
    fun deleteAddress(@AuthenticationPrincipal principal: UserPrincipal, @PathVariable id: Long): Map<String, Boolean> {
        val entity = addresses.findByIdAndUserId(id, principal.id) ?: notFound("地址不存在")
        val wasDefault = entity.isDefault
        addresses.delete(entity)
        addresses.flush()
        if (wasDefault) {
            addresses.findAllByUserIdOrderByIsDefaultDescIdDesc(principal.id).firstOrNull()?.let {
                it.isDefault = true
                it.updatedAt = Instant.now()
                addresses.save(it)
            }
        }
        return mapOf("ok" to true)
    }

    @GetMapping("/pet")
    @Transactional
    fun pet(@AuthenticationPrincipal principal: UserPrincipal): PetDto {
        lockedUser(principal)
        return mapper.pet(pets.lockByUserId(principal.id) ?: pets.save(PetProfileEntity(userId = principal.id)))
    }

    @PostMapping("/pet/action")
    @Transactional
    fun petAction(
        @AuthenticationPrincipal principal: UserPrincipal,
        @Valid @RequestBody payload: PetActionRequest,
    ): PetDto {
        val user = lockedUser(principal)
        val pet = pets.lockByUserId(principal.id) ?: pets.save(PetProfileEntity(userId = principal.id))
        val gain = when (payload.action) {
            "feed" -> PetGain(growth = 8, memberPoints = 0, mood = 12, hunger = -18, note = "喂养宠物")
            "pet" -> PetGain(growth = 5, memberPoints = 0, mood = 8, hunger = 0, note = "抚摸宠物")
            "checkin" -> PetGain(growth = 15, memberPoints = 15, mood = 6, hunger = -5, note = "每日签到")
            else -> throw IllegalArgumentException("不支持的互动方式")
        }
        val now = Instant.now()
        if (payload.action == "checkin") {
            val today = LocalDate.now(SHANGHAI_ZONE)
            val dayStart = today.atStartOfDay(SHANGHAI_ZONE).toInstant()
            val nextDayStart = today.plusDays(1).atStartOfDay(SHANGHAI_ZONE).toInstant()
            require(!pointLedgers.existsByUserIdAndActionAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                principal.id,
                "checkin",
                dayStart,
                nextDayStart,
            )) { "今日已签到" }
        }
        pet.exp += gain.growth
        pet.mood = (pet.mood + gain.mood).coerceIn(0, 100)
        pet.hunger = (pet.hunger + gain.hunger).coerceIn(0, 100)
        pet.level = when {
            pet.exp >= 1300 -> 5
            pet.exp >= 700 -> 4
            pet.exp >= 300 -> 3
            pet.exp >= 100 -> 2
            else -> 1
        }
        pet.updatedAt = now
        if (gain.memberPoints > 0) {
            user.points += gain.memberPoints
            users.save(user)
            pointLedgers.save(PointLedgerEntity(
                userId = principal.id,
                action = payload.action,
                points = gain.memberPoints,
                note = gain.note,
                createdAt = now,
            ))
        }
        return mapper.pet(pets.save(pet))
    }

    private fun currentUser(principal: UserPrincipal): UserEntity =
        users.findById(principal.id).orElseThrow { ResponseStatusException(HttpStatus.UNAUTHORIZED, "登录状态已失效") }

    private fun lockedUser(principal: UserPrincipal): UserEntity =
        users.lockById(principal.id) ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "登录状态已失效")

    private fun AddressEntity.applyWrite(payload: AddressWrite, defaultValue: Boolean): AddressEntity = apply {
        receiverName = payload.receiverName.trim()
        phone = payload.phone.trim()
        province = payload.province.trim()
        city = payload.city.trim()
        district = payload.district.trim()
        detail = payload.detail.trim()
        postalCode = payload.postalCode.trim()
        isDefault = defaultValue
        updatedAt = Instant.now()
    }

    private data class PetGain(
        val growth: Int,
        val memberPoints: Int,
        val mood: Int,
        val hunger: Int,
        val note: String,
    )

    private companion object {
        val SHANGHAI_ZONE: ZoneId = ZoneId.of("Asia/Shanghai")
    }

    private fun <T> notFound(message: String): T = throw ResponseStatusException(HttpStatus.NOT_FOUND, message)
}
