declare module 'qrcode-generator' {
  type ErrorCorrection = 'L' | 'M' | 'Q' | 'H'
  interface QRCode {
    addData(value: string): void
    make(): void
    getModuleCount(): number
    isDark(row: number, column: number): boolean
  }
  function qrcode(typeNumber: number, errorCorrectionLevel: ErrorCorrection): QRCode
  export default qrcode
}
