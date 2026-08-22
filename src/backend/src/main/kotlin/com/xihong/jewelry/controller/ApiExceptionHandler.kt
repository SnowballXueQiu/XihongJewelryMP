package com.xihong.jewelry.controller

import jakarta.validation.ConstraintViolationException
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.server.ResponseStatusException

@RestControllerAdvice
class ApiExceptionHandler {
    @ExceptionHandler(ResponseStatusException::class)
    fun responseStatus(error: ResponseStatusException) = ResponseEntity.status(error.statusCode).body(ErrorDto(error.reason ?: "请求失败"))

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun validation(error: MethodArgumentNotValidException) = ResponseEntity.badRequest().body(
        ErrorDto(error.bindingResult.fieldErrors.firstOrNull()?.defaultMessage ?: "请求参数不正确")
    )

    @ExceptionHandler(ConstraintViolationException::class, IllegalArgumentException::class)
    fun badRequest(error: Exception) = ResponseEntity.badRequest().body(ErrorDto(error.message ?: "请求参数不正确"))

    @ExceptionHandler(DataIntegrityViolationException::class)
    fun conflict() = ResponseEntity.status(HttpStatus.CONFLICT).body(ErrorDto("数据已被更新，请刷新后重试"))
}
