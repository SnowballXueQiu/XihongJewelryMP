package com.xihong.jewelry.controller

import com.xihong.jewelry.domain.PetProfileEntity
import com.xihong.jewelry.domain.UserEntity
import com.xihong.jewelry.repository.AddressRepository
import com.xihong.jewelry.repository.PetProfileRepository
import com.xihong.jewelry.repository.PointLedgerRepository
import com.xihong.jewelry.repository.UserRepository
import com.xihong.jewelry.security.TokenService
import com.xihong.jewelry.security.UserPrincipal
import com.xihong.jewelry.service.DomainMapper
import com.xihong.jewelry.service.WechatPlatformService
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import java.time.LocalDate
import java.time.ZoneId

class PetActionSecurityTest {
    @Test
    fun `feeding grows pet without minting member points`() {
        val fixture = Fixture()

        val result = fixture.controller.petAction(UserPrincipal(1), PetActionRequest("feed"))

        assertThat(result.exp).isEqualTo(8)
        assertThat(fixture.user.points).isEqualTo(100)
        Mockito.verify(fixture.users, Mockito.never()).save(fixture.user)
        Mockito.verifyNoInteractions(fixture.pointLedgers)
    }

    @Test
    fun `checkin rejects a second reward in the same Shanghai day`() {
        val fixture = Fixture()
        val shanghai = ZoneId.of("Asia/Shanghai")
        val today = LocalDate.now(shanghai)
        Mockito.`when`(fixture.pointLedgers.existsByUserIdAndActionAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
            1L,
            "checkin",
            today.atStartOfDay(shanghai).toInstant(),
            today.plusDays(1).atStartOfDay(shanghai).toInstant(),
        )).thenReturn(true)

        val error = assertThrows(IllegalArgumentException::class.java) {
            fixture.controller.petAction(UserPrincipal(1), PetActionRequest("checkin"))
        }

        assertThat(error.message).isEqualTo("今日已签到")
        assertThat(fixture.user.points).isEqualTo(100)
        assertThat(fixture.pet.exp).isZero()
    }

    private class Fixture {
        val users = Mockito.mock(UserRepository::class.java)
        val pointLedgers = Mockito.mock(PointLedgerRepository::class.java)
        val pets = Mockito.mock(PetProfileRepository::class.java)
        val user = UserEntity(id = 1, points = 100)
        val pet = PetProfileEntity(id = 1, userId = 1, exp = 0)
        val mapper = Mockito.mock(DomainMapper::class.java)
        val controller = UserController(
            users,
            Mockito.mock(AddressRepository::class.java),
            pets,
            pointLedgers,
            Mockito.mock(TokenService::class.java),
            Mockito.mock(WechatPlatformService::class.java),
            mapper,
        )

        init {
            Mockito.`when`(users.lockById(1)).thenReturn(user)
            Mockito.`when`(pets.lockByUserId(1)).thenReturn(pet)
            Mockito.`when`(pets.save(pet)).thenReturn(pet)
            Mockito.`when`(mapper.pet(pet)).thenAnswer {
                PetDto(pet.id!!, pet.userId, pet.name, pet.level, pet.exp, pet.mood, pet.hunger, 100, "测试", pet.assetKey)
            }
        }
    }
}
