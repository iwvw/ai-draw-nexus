let lastMinuteKey = ''
let minuteSequence = 0

function getMinuteKey(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

/** 当前分钟的纯时间名（不含序号），用于对话框预填，不消耗序号。 */
export function getCurrentMinuteKey(): string {
  return getMinuteKey(new Date())
}

/**
 * 生成正式项目标题：MMDD-HHMM，同一分钟内重复时追加 -V(序号) 防冲突。
 */
export function createAutoProjectTitle(): string {
  const minuteKey = getMinuteKey(new Date())
  if (minuteKey !== lastMinuteKey) {
    lastMinuteKey = minuteKey
    minuteSequence = 0
  }
  minuteSequence += 1
  return minuteSequence === 1 ? minuteKey : `${minuteKey}-V${minuteSequence}`
}
