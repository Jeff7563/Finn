/**
 * Maps typed vision error codes to user-facing, non-secret-safe Thai messages.
 * Single source of truth for user-facing vision messages across Review and Reprocess.
 */
export function getFriendlyVisionErrorMessage(errorCode?: string | null): string {
  switch (errorCode) {
    case "VISION_PROVIDER_OVERLOADED":
      return "Gemini กำลังมีผู้ใช้งานหนาแน่น กรุณาลองประมวลผลใหม่ภายหลัง";
    case "VISION_RATE_LIMITED":
      return "คำขอไปยัง Gemini ถึงขีดจำกัดชั่วคราว กรุณาลองใหม่ภายหลัง";
    case "VISION_PROVIDER_TIMEOUT":
      return "ระบบอ่านสลิปตอบกลับช้ากว่ากำหนด กรุณาลองประมวลผลใหม่อีกครั้ง";
    case "VISION_PROVIDER_UNAVAILABLE":
      return "Gemini ไม่พร้อมให้บริการชั่วคราว กรุณาลองใหม่ภายหลัง";
    case "VISION_AUTH_FAILED":
      return "ระบบเชื่อมต่อบริการอ่านสลิปไม่สำเร็จ กรุณาตรวจสอบการตั้งค่าระบบ";
    case "VISION_EMPTY_EXTRACTION":
      return "ไม่สามารถอ่านข้อมูลที่จำเป็นจากภาพสลิปได้";
    default:
      return "การประมวลผลสลิปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
  }
}
