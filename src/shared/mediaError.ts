// 媒体设备（摄像头/麦克风）启动失败时，把浏览器抛出的 DOMException 翻译成可操作的中文提示。
// 历史教训：直接打印 Error 会得到「[object Event]」这类无用信息，用户无法自助排障。

export function describeMediaError(err: unknown, device: '摄像头' | '麦克风'): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return `${device}权限被拒绝：请在浏览器地址栏的${device}图标里把权限改为「允许」后重试；如果你在用应用内嵌的浏览器面板，它无法授权，请复制地址到系统 Chrome / Edge 中打开`
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return `没有找到${device}设备：请确认${device}已连接且未被禁用`
      case 'NotReadableError':
      case 'TrackStartError':
        return `${device}被其他应用占用：请关闭其他正在使用${device}的软件（如会议软件、相机应用）后重试`
      case 'OverconstrainedError':
        return `${device}不满足请求参数：请检查设备能力或换个摄像头`
      case 'SecurityError':
        return `当前环境禁止使用${device}：需要在系统浏览器的 HTTPS 页面中打开`
      case 'AbortError':
        return `${device}启动被中止：请再试一次`
      default:
        return `${device}启动失败（${err.name}）：${err.message}`
    }
  }
  if (err instanceof Error) return `${device}启动失败：${err.message}`
  return `${device}启动失败：${String(err)}`
}
