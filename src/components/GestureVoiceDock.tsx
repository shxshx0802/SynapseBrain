import { useCallback, useEffect, useRef, useState } from 'react'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { ChevronDown, ChevronUp, Hand, Mic, MicOff, Video, VideoOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** 手势状态：拳头 / 张开 / 食指指向 / 无（与实验室同一套判定，改动需同步 src/lab/GestureLab.tsx） */
type HandGesture = 'none' | 'fist' | 'open' | 'point'

interface HandTrack {
  gesture: HandGesture
  x: number
  y: number
  present: boolean
  swinging: boolean
}

const EMPTY_TRACK: HandTrack = { gesture: 'none', x: 0.5, y: 0.5, present: false, swinging: false }

function classify(lm: NormalizedLandmark[]): HandGesture {
  const wrist = lm[0]
  const dist = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y)
  const pairs: Array<[number, number]> = [
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ]
  let extended = 0
  for (const [tip, pip] of pairs) {
    if (dist(wrist, lm[tip]) > dist(wrist, lm[pip]) * 1.12) extended++
  }
  if (extended >= 4) return 'open'
  if (extended <= 1) return 'fist'
  if (dist(wrist, lm[8]) > dist(wrist, lm[6]) * 1.15) return 'point'
  return 'none'
}

/** 语音唤醒相关最小类型声明（Chromium SpeechRecognition） */
interface SRResultLike {
  isFinal: boolean
  0: { transcript: string }
}
interface SREventLike {
  resultIndex: number
  results: { length: number; [i: number]: SRResultLike }
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SREventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
}

const WAKE_RE = /(小\s*[kKｋＫ])|(kimi)/i
const SYNTH_POINTER_ID = 9001

interface Props {
  /** 摆动缩放：左手摆动传 'in'，右手摆动传 'out' */
  onZoom: (dir: 'in' | 'out') => void
  /** 唤醒词后的语音发言，送入讨论 */
  onVoiceCommand: (text: string) => void
}

/**
 * 手势 & 语音控制坞（讨论室版）
 * 手势：张开双手唤醒 → 光标跟随食指 → 左摆放大 / 右摆缩小 → 右手握拳抓球拖动 → 左手握拳双击打开
 * 语音：唤醒词「小K」→ 6 秒内发言 → onVoiceCommand 送入讨论
 * 抓取/双击通过向 [data-sphere] 元素派发合成指针事件实现，复用 CanvasBoard 现有交互逻辑。
 */
export function GestureVoiceDock({ onZoom, onVoiceCommand }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const landmarkerRef = useRef<HandLandmarker | null>(null)
  const lastVideoTimeRef = useRef(-1)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const grabRef = useRef<{ el: HTMLElement } | null>(null)
  const lastFistRef = useRef<{ left: boolean; right: boolean }>({ left: false, right: false })
  const swingHistRef = useRef<{ left: Array<{ t: number; x: number }>; right: Array<{ t: number; x: number }> }>({
    left: [],
    right: [],
  })
  const lastZoomPulseRef = useRef(0)
  const cursorPosRef = useRef<{ x: number; y: number } | null>(null)
  const errCountRef = useRef(0)
  const voiceFailsRef = useRef(0)
  const swapHandsRef = useRef(false)
  const statusTimerRef = useRef(0)
  const gestureModeRef = useRef(false)
  const noneSinceRef = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const [camOn, setCamOn] = useState(false)
  const [camBusy, setCamBusy] = useState(false)
  const [voiceOn, setVoiceOn] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [swapHands, setSwapHands] = useState(false)
  const [gestureMode, setGestureMode] = useState(false)
  const [left, setLeft] = useState<HandTrack>(EMPTY_TRACK)
  const [right, setRight] = useState<HandTrack>(EMPTY_TRACK)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [grabbing, setGrabbing] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [log, setLog] = useState<Array<{ t: string; text: string }>>([])

  const addLog = useCallback((text: string) => {
    setLog((prev) => [{ t: new Date().toLocaleTimeString(), text }, ...prev].slice(0, 5))
    try {
      const buf = JSON.parse(localStorage.getItem('ks-dock-log') || '[]') as Array<{ t: string; text: string }>
      buf.push({ t: new Date().toLocaleTimeString(), text })
      localStorage.setItem('ks-dock-log', JSON.stringify(buf.slice(-60)))
    } catch {
      /* 忽略 */
    }
  }, [])

  const beep = useCallback((freq = 880, dur = 0.12) => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
      const ctx = audioCtxRef.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.value = 0.08
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + dur)
    } catch {
      /* 音频不可用时静默 */
    }
  }, [])

  const pushSwing = (side: 'left' | 'right', x: number) => {
    const hist = swingHistRef.current[side]
    const now = performance.now()
    hist.push({ t: now, x })
    while (hist.length > 0 && now - hist[0].t > 600) hist.shift()
  }

  const isSwinging = (side: 'left' | 'right') => {
    const hist = swingHistRef.current[side]
    if (hist.length < 4) return false
    let travel = 0
    for (let i = 1; i < hist.length; i++) travel += Math.abs(hist[i].x - hist[i - 1].x)
    return travel > 0.25
  }

  /** 向目标元素派发合成指针事件（复用 CanvasBoard 的 drag / 双击检测） */
  const firePointer = (el: Element, type: string, x: number, y: number, buttons: number) => {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: SYNTH_POINTER_ID,
        pointerType: 'mouse',
        isPrimary: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons,
      }),
    )
  }

  const fireDoubleTap = async (el: Element, x: number, y: number) => {
    for (let i = 0; i < 2; i++) {
      firePointer(el, 'pointerdown', x, y, 1)
      firePointer(el, 'pointerup', x, y, 0)
      await new Promise((r) => setTimeout(r, 90))
    }
  }

  const ensureLandmarker = async () => {
    if (landmarkerRef.current) return
    const vision = await FilesetResolver.forVisionTasks('/mp/wasm')
    // CPU 推理：部分显卡驱动下 GPU 推理（WebGL）与画布绘制并存会崩 GPU 进程导致整页黑屏，
    // 稳定性优先改用 CPU；分辨率降到 480x360 控制 CPU 占用
    landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: '/mp/hand_landmarker.task', delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })
  }

  const stopVideo = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    const video = videoRef.current
    if (video) video.srcObject = null
    setCamOn(false)
  }, [])

  const startVideo = async () => {
    setCamBusy(true)
    try {
      await ensureLandmarker()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 360, facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play()
      setCamOn(true)
      addLog('✅ 手势控制已启动（张开双手唤醒）')
      const loop = () => {
        rafRef.current = requestAnimationFrame(loop)
        const v = videoRef.current
        const lm = landmarkerRef.current
        if (!v || !lm || v.readyState < 2 || v.currentTime === lastVideoTimeRef.current) return
        lastVideoTimeRef.current = v.currentTime
        try {
          const res = lm.detectForVideo(v, performance.now())
          errCountRef.current = 0
          handleHands(res.landmarks, res.handedness)
        } catch {
          errCountRef.current++
          if (errCountRef.current > 30) {
            cancelAnimationFrame(rafRef.current)
            addLog('❌ 手势推理连续失败，请重新启动手势')
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    } catch (err) {
      addLog(`❌ 摄像头启动失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setCamBusy(false)
    }
  }

  /** 每帧手势处理（与实验室验证过的逻辑一致） */
  const handleHands = (landmarks: NormalizedLandmark[][], handedness: Array<Array<{ categoryName: string; score: number }>>) => {
    const now = performance.now()
    const tracks: Record<'left' | 'right', HandTrack> = { left: { ...EMPTY_TRACK }, right: { ...EMPTY_TRACK } }
    const tips: Partial<Record<'left' | 'right', NormalizedLandmark>> = {}

    landmarks.forEach((lm, i) => {
      const rawLabel = handedness[i]?.[0]?.categoryName ?? 'Right'
      const side: 'left' | 'right' = swapHandsRef.current ? (rawLabel === 'Left' ? 'left' : 'right') : rawLabel === 'Right' ? 'left' : 'right'
      const gesture = classify(lm)
      const wx = 1 - lm[0].x
      pushSwing(side, wx)
      tracks[side] = { gesture, x: wx, y: lm[0].y, present: true, swinging: isSwinging(side) }
      tips[side] = lm[8]
    })

    const tip = tips.right ?? tips.left
    const cursor = cursorRef.current
    if (tip && cursor) {
      const rawX = (1 - tip.x) * window.innerWidth
      const rawY = tip.y * window.innerHeight
      const prev = cursorPosRef.current
      let cx = rawX
      let cy = rawY
      if (prev) {
        cx = prev.x + (rawX - prev.x) * 0.32
        cy = prev.y + (rawY - prev.y) * 0.32
        if (Math.hypot(cx - prev.x, cy - prev.y) < 1.5) {
          cx = prev.x
          cy = prev.y
        }
      }
      const moved = !prev || cx !== prev.x || cy !== prev.y
      cursorPosRef.current = { x: cx, y: cy }
      if (moved) {
        cursor.style.transform = `translate(${cx - 16}px, ${cy - 16}px) scale(${grabRef.current ? 0.8 : 1})`
      }
      cursor.style.opacity = '1'
      if (!cursorVisible) setCursorVisible(true)

      // 右手握拳 = 抓取拖动真实关键球
      const rightFist = tracks.right.gesture === 'fist'
      if (rightFist && !lastFistRef.current.right) {
        const target = document.elementFromPoint(cx, cy)?.closest('[data-sphere]') as HTMLElement | null
        if (target) {
          grabRef.current = { el: target }
          firePointer(target, 'pointerdown', cx, cy, 1)
          setGrabbing(true)
          beep(660, 0.08)
        }
      } else if (!rightFist && lastFistRef.current.right && grabRef.current) {
        firePointer(grabRef.current.el, 'pointerup', cx, cy, 0)
        grabRef.current = null
        setGrabbing(false)
      } else if (rightFist && grabRef.current) {
        firePointer(grabRef.current.el, 'pointermove', cx, cy, 1)
      }

      // 左手握拳 = 双击打开关键球内容
      const leftFist = tracks.left.gesture === 'fist'
      if (leftFist && !lastFistRef.current.left && gestureModeRef.current) {
        const target = document.elementFromPoint(cx, cy)?.closest('[data-sphere]') as HTMLElement | null
        if (target) {
          void fireDoubleTap(target, cx, cy)
          addLog(`👊 双击打开「${target.textContent?.trim().slice(0, 12) ?? '关键球'}」`)
          beep(520, 0.1)
        }
      }
      lastFistRef.current = { left: leftFist, right: rightFist }
    } else if (cursor) {
      cursor.style.opacity = '0'
      cursorPosRef.current = null
      if (cursorVisible) setCursorVisible(false)
      lastFistRef.current = { left: false, right: false }
    }

    // 张开双手唤醒 / 双手离开 2.5s 自动退出
    const bothOpen = tracks.left.gesture === 'open' && tracks.right.gesture === 'open'
    const nonePresent = !tracks.left.present && !tracks.right.present
    if (bothOpen && !gestureModeRef.current) {
      setGestureMode(true)
      addLog('🙌 手势控制已唤醒：左摆放大 / 右摆缩小 / 右拳抓球 / 左拳打开')
      beep(880, 0.15)
    }
    if (nonePresent && gestureModeRef.current) {
      noneSinceRef.current++
      if (noneSinceRef.current > 150) {
        setGestureMode(false)
        addLog('🖐 双手离开画面，手势控制已退出')
      }
    } else {
      noneSinceRef.current = 0
    }

    // 摆动缩放（200ms 节流）
    if (gestureModeRef.current) {
      const dir = tracks.left.swinging && tracks.left.gesture !== 'fist' ? 'in' : tracks.right.swinging && tracks.right.gesture !== 'fist' ? 'out' : null
      if (dir && now - lastZoomPulseRef.current > 200) {
        lastZoomPulseRef.current = now
        onZoomRef.current(dir)
      }
    }

    if (now - statusTimerRef.current > 200) {
      statusTimerRef.current = now
      setLeft(tracks.left)
      setRight(tracks.right)
    }
  }

  // 回调/ref 同步，避免 rAF 闭包过期
  const onZoomRef = useRef(onZoom)
  useEffect(() => {
    onZoomRef.current = onZoom
  }, [onZoom])
  useEffect(() => {
    gestureModeRef.current = gestureMode
  }, [gestureMode])
  useEffect(() => {
    swapHandsRef.current = swapHands
  }, [swapHands])

  /** 启动语音识别：申请麦克风前临时关闭摄像头（规避 GPU 崩溃），完成后恢复 */
  const startVoice = async () => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Ctor) {
      setVoiceError('当前浏览器不支持语音识别（需 Chromium 内核）')
      return
    }
    setVoiceError('')
    const hadCamera = !!streamRef.current
    if (hadCamera) {
      addLog('🎙️ 暂闭摄像头以申请麦克风权限…')
      stopVideo()
    }
    addLog('🎙️ 请求麦克风权限…')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((t) => t.stop())
    } catch (err) {
      setVoiceError('麦克风权限被拒')
      addLog(`⚠️ 麦克风权限被拒：${err instanceof Error ? err.message : err}`)
      if (hadCamera) void startVideo()
      return
    }
    if (hadCamera) void startVideo()

    const rec = new Ctor()
    recRef.current = rec
    rec.lang = 'zh-CN'
    rec.continuous = true
    rec.interimResults = true
    let commandBuf = ''
    let deadline = 0

    rec.onresult = (e) => {
      voiceFailsRef.current = 0
      let finalText = ''
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interimText += r[0].transcript
      }
      const text = finalText || interimText
      if (!text) return
      const active = Date.now() < deadline
      if (!active) {
        const m = text.match(WAKE_RE)
        if (m) {
          deadline = Date.now() + 6000
          commandBuf = text.slice((m.index ?? 0) + m[0].length).trim()
          addLog(`🔔 已唤醒，请说出你的观点…`)
          beep(1046, 0.1)
          setTimeout(() => beep(1318, 0.12), 130)
        }
      } else {
        commandBuf = (commandBuf + ' ' + text).trim()
        deadline = Date.now() + 6000
        if (finalText) {
          const cmd = commandBuf
          commandBuf = ''
          deadline = 0
          addLog(`🎤 发言：${cmd.slice(0, 30)}`)
          onVoiceCommandRef.current(cmd)
          beep(784, 0.1)
        }
      }
    }
    rec.onerror = (e) => {
      voiceFailsRef.current++
      addLog(`⚠️ 语音错误：${e.error}`)
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || voiceFailsRef.current > 5) recRef.current = null
    }
    rec.onend = () => {
      setVoiceOn(false)
      if (recRef.current === rec) {
        if (voiceFailsRef.current > 5) {
          recRef.current = null
          addLog('🎙️ 语音连续失败已停止，可重点「启动语音」重试')
          return
        }
        window.setTimeout(() => {
          if (recRef.current !== rec) return
          try {
            rec.start()
            setVoiceOn(true)
          } catch {
            /* 重复 start 抛错忽略 */
          }
        }, 800)
      }
    }
    try {
      rec.start()
      setVoiceOn(true)
      addLog('🎙️ 语音已启动，唤醒词「小K」')
    } catch (err) {
      setVoiceError(String(err))
    }
  }

  const onVoiceCommandRef = useRef(onVoiceCommand)
  useEffect(() => {
    onVoiceCommandRef.current = onVoiceCommand
  }, [onVoiceCommand])

  const stopVoice = useCallback(() => {
    const rec = recRef.current
    recRef.current = null
    if (rec) rec.abort()
    setVoiceOn(false)
  }, [])

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      recRef.current?.abort()
    },
    [],
  )

  const gestureText = (t: HandTrack) => (!t.present ? '—' : t.gesture === 'fist' ? '✊' : t.gesture === 'open' ? '🖐' : t.gesture === 'point' ? '👆' : '·')

  return (
    <>
      {/* 手势光标 */}
      <div ref={cursorRef} className="pointer-events-none fixed left-0 top-0 z-50 h-8 w-8 opacity-0 transition-opacity duration-150">
        <div className={`h-full w-full rounded-full border-2 ${grabbing ? 'border-pink-400 bg-pink-400/20' : 'border-white/80 bg-white/10'} shadow-[0_0_18px_rgba(255,255,255,0.5)]`} />
      </div>

      <div className="fixed bottom-4 right-4 z-40 w-64 rounded-xl border border-slate-700/60 bg-slate-950/90 p-3 shadow-2xl backdrop-blur">
        <div className="mb-2 flex items-center gap-1.5">
          <Hand className={`h-4 w-4 ${camOn ? 'text-emerald-400' : 'text-slate-500'}`} />
          <Mic className={`h-4 w-4 ${voiceOn ? 'text-emerald-400' : 'text-slate-500'}`} />
          <span className="ml-1 text-xs font-medium text-slate-300">手势 & 语音</span>
          {gestureMode && <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">已唤醒</span>}
          <button className="ml-auto text-slate-500 hover:text-slate-300" onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>

        {expanded && (
          <>
            <div className="mb-2 flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 flex-1 text-xs"
                disabled={camBusy}
                onClick={() => (camOn ? stopVideo() : void startVideo())}
              >
                {camOn ? <VideoOff className="mr-1 h-3 w-3" /> : <Video className="mr-1 h-3 w-3" />}
                {camBusy ? '启动中…' : camOn ? '停手势' : '启手势'}
              </Button>
              <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={() => (voiceOn ? stopVoice() : void startVoice())}>
                {voiceOn ? <MicOff className="mr-1 h-3 w-3" /> : <Mic className="mr-1 h-3 w-3" />}
                {voiceOn ? '停语音' : '启语音'}
              </Button>
              <Button size="sm" variant={swapHands ? 'default' : 'outline'} className="h-7 px-2 text-xs" onClick={() => setSwapHands((v) => !v)}>
                换
              </Button>
            </div>

            <div className="relative mb-2 overflow-hidden rounded-lg bg-black" style={{ height: camOn ? 72 : 0, transition: 'height .3s' }}>
              <video ref={videoRef} playsInline muted autoPlay className="h-full w-full -scale-x-100 object-cover" />
            </div>

            <div className="mb-2 flex items-center gap-3 text-[11px] text-slate-400">
              <span>左 {gestureText(left)}{left.swinging ? ' ↔' : ''}</span>
              <span>右 {gestureText(right)}{right.swinging ? ' ↔' : ''}</span>
              <span className="ml-auto">{cursorVisible ? '● 光标' : '○ 光标'}</span>
            </div>

            {voiceError && <p className="mb-1 text-[11px] text-red-400">{voiceError}</p>}

            <div className="max-h-20 space-y-0.5 overflow-y-auto font-mono text-[10px] leading-tight text-slate-500">
              {log.map((l, i) => (
                <p key={i} className="truncate">{l.t.slice(9)} {l.text}</p>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
