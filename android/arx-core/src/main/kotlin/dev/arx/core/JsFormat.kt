package dev.arx.core

import java.math.BigDecimal
import java.math.RoundingMode

/** Number formatting that matches the JavaScript validator's messages. */
internal object JsFormat {
    /** `Number.prototype.toFixed`: exact binary value, ties away from zero. */
    fun toFixed(value: Double, digits: Int): String {
        if (!value.isFinite()) return value.toString()
        return BigDecimal(value).setScale(digits, RoundingMode.HALF_UP).toPlainString()
    }

    /** Template-literal form for the values seen here: integers without a fraction. */
    fun number(value: Double): String =
        if (value == Math.rint(value) && kotlin.math.abs(value) < 1e15) value.toLong().toString() else value.toString()
}
