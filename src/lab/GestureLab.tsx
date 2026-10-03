import { useCallback, useEffect, useRef, useState } from 'react'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { Camera, FlipHorizontal2, Hand, Mic, MicOff, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { describeMediaError } from '@/shared/mediaError'

/** 手势状态：拳头 / 张开 / 食指指向 / 无 */
type HandGesture = 'none' | 'fist' | 'open' | 'point'

interface HandTrack {
  gesture: HandGesture
  /** 用户视角（镜像后）的腕部位置 0~1 */
  x: number
  y: number
  present: boolean
  /** 左右摆动中（用于缩放触发） */
  swinging: boolean
}

const EMPTY_TRACK: HandTrack = { gesture: 'none', x: 0.5, y: 0.5, present: false, swinging: false }

interface LabSphere {
  id: string
  label: string
  content: string
  x: number
  y: number
  color: string
}

const INITIAL_SPHERES: LabSphere[] = [
  { id: 'a', label: '方向一', content: '关键球 A 的详细内容：这是手势双击打开的内容面板测试。', x: 60, y: 60, color: '#9aa3af' },
  { id: 'b', label: '方向二', content: '关键球 B 的详细内容：右手握拳抓取拖动测试。', x: 240, y: 150, color: '#8b9bb4' },
  { id: 'c', label: '方向三', content: '关键球 C 的详细内容：第三个测试球。', x: 420, y: 70, color: '#a4a0b8' },
]

/** 根据 21 个手部关键点判定手势 */
function classify(lm: NormalizedLandmark[]): HandGesture {
  const wrist = lm[0]
  const dist = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y)
  const pairs: Array<[number, number]> = [
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ]
  // 伸直：指尖明显比指根离手腕更远；蜷曲：指尖明显收近手腕。
  // 两级阈值避免「手指稍弯（放松半握）」被误判为握拳——必须明显蜷曲才算拳
  const RATIO_EXTEND = 1.18
  const RATIO_CURL = 0.92
  let extended = 0
  let curled = 0
  for (const [tip, pip] of pairs) {
    const ratio = dist(wrist, lm[tip]) / Math.max(dist(wrist, lm[pip]), 1e-6)
    if (ratio > RATIO_EXTEND) extended++
    else if (ratio < RATIO_CURL) curled++
  }
  if (extended >= 4) return 'open'
  if (curled >= 4 || (curled >= 3 && extended === 0)) return 'fist'
  if (extended === 1 && dist(wrist, lm[8]) > dist(wrist, lm[6]) * RATIO_EXTEND) return 'point'
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

export default function GestureLab() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const landmarkerRef = useRef<HandLandmarker | null>(null)
  const lastVideoTimeRef = useRef(-1)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const grabRef = useRef<{ el: HTMLElement } | null>(null)
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const lastFistRef = useRef<{ left: boolean; right: boolean }>({ left: false, right: false })
  const swingHistRef = useRef<{ left: Array<{ t: number; x: number }>; right: Array<{ t: number; x: number }> }>({
    left: [],
    right: [],
  })
  const lastZoomPulseRef = useRef(0)
  const lastZoomDirRef = useRef<'in' | 'out' | null>(null)
  /** 光标平滑：指数滑动平均的当前位置 */
  const cursorPosRef = useRef<{ x: number; y: number } | null>(null)
  /** 连续推理错误计数，超过阈值自动重启推理循环 */
  const errCountRef = useRef(0)
  /** 语音识别连续失败次数 */
  const voiceFailsRef = useRef(0)
  const modeOffAtRef = useRef(0)
  const voiceActiveRef = useRef(false)
  const voiceDeadlineRef = useRef(0)
  const voiceCommandRef = useRef('')
  /** 左右手判定是否交换（光标始终镜像跟随，此开关只交换左右手语义） */
  const swapHandsRef = useRef(false)
  const statusTimerRef = useRef(0)

  const [camStatus, setCamStatus] = useState<'idle' | 'starting' | 'ready' | 'error'>('idle')
  const [camError, setCamError] = useState('')
  const [voiceSupported, setVoiceSupported] = useState<boolean | null>(null)
  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [interim, setInterim] = useState('')
  const [gestureMode, setGestureMode] = useState(false)
  const [left, setLeft] = useState<HandTrack>(EMPTY_TRACK)
  const [right, setRight] = useState<HandTrack>(EMPTY_TRACK)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [zoomDir, setZoomDir] = useState<'in' | 'out' | null>(null)
  const [grabLabel, setGrabLabel] = useState<string | null>(null)
  const [opened, setOpened] = useState<string | null>(null)
  const [swapHands, setSwapHands] = useState(false)
  const [spheres, setSpheres] = useState<LabSphere[]>(INITIAL_SPHERES)
  const [log, setLog] = useState<Array<{ t: string; text: string }>>([])

  /** 日志同时写入 localStorage：页面崩溃后刷新仍能看到崩溃前的记录 */
  const addLog = useCallback((text: string) => {
    setLog((prev) => [{ t: new Date().toLocaleTimeString(), text }, ...prev].slice(0, 60))
    try {
      const buf = JSON.parse(localStorage.getItem('ks-lab-log') || '[]') as Array<{ t: string; text: string }>
      buf.push({ t: new Date().toLocaleTimeString(), text })
      localStorage.setItem('ks-lab-log', JSON.stringify(buf.slice(-100)))
    } catch {
      /* 存储不可用时忽略 */
    }
  }, [])

  /** 挂载时恢复上次会话（崩溃前）的日志 */
  useEffect(() => {
    try {
      const buf = JSON.parse(localStorage.getItem('ks-lab-log') || '[]') as Array<{ t: string; text: string }>
      localStorage.removeItem('ks-lab-log')
      if (buf.length > 0) {
        setLog([{ t: new Date().toLocaleTimeString(), text: `—— 上次会话日志（崩溃前，共 ${buf.length} 条）——` }, ...buf.slice(-30).reverse()])
      }
    } catch {
      /* 忽略 */
    }
  }, [])

  /** 提示音（唤醒 / 抓取反馈），复用同一个 AudioContext */
  const audioCtxRef = useRef<AudioContext | null>(null)
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
      /* 音频不可用则静默 */
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

  /** 在光标处向目标元素派发合成指针事件（供抓取/双击使用） */
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

  /** 模拟双击（真实 dblclick 被 pointer capture 截走的场景下用两次轻点替代） */
  const fireDoubleTap = async (el: Element, x: number, y: number) => {
    for (let i = 0; i < 2; i++) {
      firePointer(el, 'pointerdown', x, y, 1)
      firePointer(el, 'pointerup', x, y, 0)
      await new Promise((r) => setTimeout(r, 90))
    }
  }

  /** 手势引擎只需创建一次，摄像头可反复启停 */
  const ensureLandmarker = async () => {
    if (landmarkerRef.current) return
    // 必须用 BASE_URL 拼路径：GitHub Pages 部署在 /SynapseBrain/ 子路径，硬编码 '/mp/...' 会 404
    const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
    const vision = await FilesetResolver.forVisionTasks(`${base}mp/wasm`)
    // CPU 推理：部分显卡驱动下 GPU 推理（WebGL）与画布绘制并存会崩 GPU 进程导致整页黑屏
    landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: `${base}mp/hand_landmarker.task`, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })
  }

  /** 停止视频采集（保留手势引擎，供语音授权等场景临时让出摄像头） */
  const stopVideo = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    const video = videoRef.current
    if (video) video.srcObject = null
    setCamStatus('idle')
  }, [])

  /** 启动摄像头 + 手势识别 */
  const startCamera = async () => {
    setCamStatus('starting')
    setCamError('')
    try {
      await ensureLandmarker()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 360, facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      // 系统中断监测：授权弹窗 / 设备占用可能把视频轨道打断，记录并提示
      stream.getVideoTracks().forEach((t) => {
        t.addEventListener('mute', () => addLog('⚠️ 摄像头画面中断（mute），等待恢复…'))
        t.addEventListener('unmute', () => addLog('✅ 摄像头画面已恢复'))
        t.addEventListener('ended', () => {
          setCamStatus('error')
          setCamError('摄像头被系统中断（可能因其他应用占用），请刷新页面重试')
          addLog('❌ 摄像头轨道已结束（ended）')
        })
      })
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play()

      setCamStatus('ready')
      addLog('✅ 摄像头与手势引擎已就绪')

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
        } catch (err) {
          // 推理异常不能让 rAF 循环死掉，连续失败则终止并提示
          errCountRef.current++
          if (errCountRef.current > 30) {
            cancelAnimationFrame(rafRef.current)
            setCamStatus('error')
            setCamError('手势推理连续失败，请刷新页面重试')
            addLog(`❌ 手势推理异常：${err instanceof Error ? err.message : err}`)
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    } catch (err) {
      setCamStatus('error')
      const msg = describeMediaError(err, '摄像头')
      setCamError(msg)
      addLog(`❌ ${msg}`)
    }
  }

  /** 每帧手势处理：分类、摆动累计、光标、模式、缩放、抓取、双击 */
  const handleHands = (landmarks: NormalizedLandmark[][], handedness: Array<Array<{ categoryName: string; score: number }>>) => {
    const now = performance.now()
    const tracks: Record<'left' | 'right', HandTrack> = {
      left: { ...EMPTY_TRACK },
      right: { ...EMPTY_TRACK },
    }
    const tips: Partial<Record<'left' | 'right', NormalizedLandmark>> = {}

    landmarks.forEach((lm, i) => {
      const rawLabel = handedness[i]?.[0]?.categoryName ?? 'Right'
      // MediaPipe 在自拍视角下：画面里的 "Right" 是用户的左手。交换开关只翻转此映射，
      // 光标镜像始终开启（与镜面预览一致），保证手往哪移光标就往哪移
      const side: 'left' | 'right' = swapHandsRef.current ? (rawLabel === 'Left' ? 'left' : 'right') : rawLabel === 'Right' ? 'left' : 'right'
      const gesture = classify(lm)
      const wx = 1 - lm[0].x
      pushSwing(side, wx)
      tracks[side] = { gesture, x: wx, y: lm[0].y, present: true, swinging: isSwinging(side) }
      tips[side] = lm[8]
    })

    // 光标跟随食指指尖（优先右手，其次左手）
    // 平滑处理：指数滑动平均 + 死区，避免识别噪声导致光标左右摇晃
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
        // 死区： smoothed 位移 <1.5px 视为静止，不更新 DOM
        if (Math.hypot(cx - prev.x, cy - prev.y) < 1.5) {
          cx = prev.x
          cy = prev.y
        }
      }
      const moved = !prev || cx !== prev.x || cy !== prev.y
      cursorPosRef.current = { x: cx, y: cy }
      if (moved) {
        cursor.style.transform = `translate(${cx - 16}px, ${cy - 16}px) scale(${grabRef.current ? 0.8 : 1})`
        cursor.dataset.x = String(cx)
        cursor.dataset.y = String(cy)
      }
      cursor.style.opacity = '1'
      if (!cursorVisible) setCursorVisible(true)

      const inMode = gestureModeRef.current
      const anyFist = tracks.left.gesture === 'fist' || tracks.right.gesture === 'fist'
      if (inMode && !anyFist && !grabRef.current) window.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy, pointerId: SYNTH_POINTER_ID }))

      // 右手握拳 = 抓取拖动
      const rightFist = tracks.right.gesture === 'fist'
      if (rightFist && !lastFistRef.current.right) {
        const target = document.elementFromPoint(cx, cy)?.closest('[data-lab-sphere]') as HTMLElement | null
        if (target) {
          grabRef.current = { el: target }
          firePointer(target, 'pointerdown', cx, cy, 1)
          setGrabLabel(target.dataset.labSphere ?? null)
          beep(660, 0.08)
        }
      } else if (!rightFist && lastFistRef.current.right && grabRef.current) {
        firePointer(grabRef.current.el, 'pointerup', cx, cy, 0)
        grabRef.current = null
        setGrabLabel(null)
      } else if (rightFist && grabRef.current) {
        firePointer(grabRef.current.el, 'pointermove', cx, cy, 1)
      }

      // 左手握拳 = 双击打开内容
      const leftFist = tracks.left.gesture === 'fist'
      if (leftFist && !lastFistRef.current.left && inMode) {
        const target = document.elementFromPoint(cx, cy)?.closest('[data-lab-sphere]') as HTMLElement | null
        if (target) {
          void fireDoubleTap(target, cx, cy)
          addLog(`👊 左手握拳 → 双击「${target.dataset.labSphere}」`)
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

    // 张开双手唤醒 / 双手消失自动退出
    const bothOpen = tracks.left.gesture === 'open' && tracks.right.gesture === 'open'
    const nonePresent = !tracks.left.present && !tracks.right.present
    if (bothOpen && now - modeOffAtRef.current > 3000) {
      modeOffAtRef.current = now
      setGestureMode(true)
      addLog('🙌 张开双手 → 手势控制已唤醒')
      beep(880, 0.15)
    }
    if (nonePresent && gestureModeRef.current) {
      noneSinceRef.current++
      if (noneSinceRef.current > 150) {
        // ~2.5s @60fps 无手
        setGestureMode(false)
        modeOffAtRef.current = 0
        addLog('🖐 双手离开画面 → 手势控制已退出')
      }
    } else {
      noneSinceRef.current = 0
    }

    // 摆动缩放：左手摆动放大 / 右手摆动缩小
    if (gestureModeRef.current) {
      const dir = tracks.left.swinging && tracks.left.gesture !== 'fist' ? 'in' : tracks.right.swinging && tracks.right.gesture !== 'fist' ? 'out' : null
      if (dir && now - lastZoomPulseRef.current > 200) {
        lastZoomPulseRef.current = now
        setZoomLevel((z) => Math.min(3, Math.max(0.5, z + (dir === 'in' ? 0.08 : -0.08))))
        if (lastZoomDirRef.current !== dir) {
          lastZoomDirRef.current = dir
          setZoomDir(dir)
        }
      } else if (!dir && lastZoomDirRef.current !== null) {
        lastZoomDirRef.current = null
        setZoomDir(null)
      }
    }

    drawOverlay(landmarks)

    // 节流刷新状态面板（~5 次/秒）
    if (now - statusTimerRef.current > 200) {
      statusTimerRef.current = now
      setLeft(tracks.left)
      setRight(tracks.right)
    }
  }

  // 供 rAF 回调读取最新状态而不闭包过期
  const gestureModeRef = useRef(false)
  const noneSinceRef = useRef(0)
  useEffect(() => {
    gestureModeRef.current = gestureMode
  }, [gestureMode])
  useEffect(() => {
    swapHandsRef.current = swapHands
  }, [swapHands])

  /** 摄像头预览上绘制手部骨架 */
  const drawOverlay = (landmarks: NormalizedLandmark[][]) => {
    const canvas = overlayRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    const w = video.videoWidth || 640
    const h = video.videoHeight || 480
    if (canvas.width !== w) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    const bones: Array<[number, number]> = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12],
      [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20],
      [0, 17],
    ]
    for (const lm of landmarks) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'
      ctx.lineWidth = 2
      for (const [a, b] of bones) {
        ctx.beginPath()
        ctx.moveTo(lm[a].x * w, lm[a].y * h)
        ctx.lineTo(lm[b].x * w, lm[b].y * h)
        ctx.stroke()
      }
      ctx.fillStyle = '#fff'
      for (const p of lm) {
        ctx.beginPath()
        ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = '#f472b6'
      ctx.beginPath()
      ctx.arc(lm[8].x * w, lm[8].y * h, 6, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  /** 启动语音识别 + 唤醒词「小K」：先显式申请麦克风权限，再启动识别 */
  const startVoice = async () => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Ctor) {
      setVoiceSupported(false)
      setVoiceError('当前浏览器不支持语音识别（需要 Chromium 内核）')
      return
    }
    setVoiceSupported(true)
    // 关键规避：视频采集中弹出麦克风授权气泡会在部分显卡驱动上崩掉 GPU 进程（页面黑屏）。
    // 因此授权前先临时停掉摄像头，授权完成后再恢复；麦克风权限只需授予一次，
    // 之后启动语音不再弹气泡，也不会再触发崩溃。
    const hadCamera = camStatus === 'ready'
    if (hadCamera) {
      addLog('🎙️ 暂时关闭摄像头以申请麦克风权限…')
      stopVideo()
    }
    addLog('🎙️ 正在请求麦克风权限…')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((t) => t.stop())
      addLog('🎙️ 麦克风权限已获取')
    } catch (err) {
      setVoiceError('麦克风权限被拒')
      addLog(`⚠️ ${describeMediaError(err, '麦克风')}`)
      if (hadCamera) void startCamera()
      return
    }
    if (hadCamera) {
      addLog('🎙️ 恢复摄像头…')
      void startCamera()
    }
    addLog('🎙️ 正在启动识别器…')
    const rec = new Ctor()
    recRef.current = rec
    rec.lang = 'zh-CN'
    rec.continuous = true
    rec.interimResults = true
    rec.onstart = () => addLog('🎙️ 识别器 onstart 已触发（音频采集开始）')

    rec.onresult = (e) => {
      voiceFailsRef.current = 0
      let finalText = ''
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interimText += r[0].transcript
      }
      setInterim(interimText)

      const text = finalText || interimText
      if (!text) return
      if (!voiceActiveRef.current) {
        const m = text.match(WAKE_RE)
        if (m) {
          voiceActiveRef.current = true
          voiceDeadlineRef.current = Date.now() + 6000
          voiceCommandRef.current = text.slice((m.index ?? 0) + m[0].length).trim()
          addLog(`🔔 唤醒词「${m[0]}」已识别，请说出你的观点（6 秒内）`)
          beep(1046, 0.1)
          setTimeout(() => beep(1318, 0.12), 130)
        }
      } else {
        voiceCommandRef.current = (voiceCommandRef.current + ' ' + text).trim()
        voiceDeadlineRef.current = Date.now() + 6000
        if (finalText) {
          // 收到一句完整发言即提交
          const cmd = voiceCommandRef.current
          voiceActiveRef.current = false
          voiceCommandRef.current = ''
          addLog(`🎤 参与讨论：${cmd}`)
          beep(784, 0.1)
        }
      }
    }
    rec.onerror = (e) => {
      setVoiceError(e.error)
      voiceFailsRef.current++
      addLog(`⚠️ 语音识别错误：${e.error}`)
      // 权限被拒或服务不可用时不再自动重试，避免重启自旋卡死页面
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || voiceFailsRef.current > 5) {
        recRef.current = null
      }
    }
    rec.onend = () => {
      setVoiceListening(false)      // 连续模式被系统打断时自动重启，保持常听；带退避，失败过多则放弃
      if (recRef.current === rec) {
        if (voiceFailsRef.current > 5) {
          addLog('🎙️ 语音连续失败，已停止自动重试（可点击「启动语音」再试）')
          recRef.current = null
          return
        }
        window.setTimeout(() => {
          if (recRef.current !== rec) return
          try {
            rec.start()
            setVoiceListening(true)
          } catch {
            /* 重复 start 会抛错，忽略 */
          }
        }, 800)
      }
    }
    try {
      rec.start()
      setVoiceListening(true)
      setVoiceError('')
      addLog('🎙️ 语音识别已启动，唤醒词：「小K」')
    } catch (err) {
      setVoiceError(String(err))
    }
  }

  const stopVoice = useCallback(() => {
    const rec = recRef.current
    recRef.current = null
    if (rec) rec.abort()
    setVoiceListening(false)
    setInterim('')
  }, [])

  /** 命令窗口超时提交 */
  useEffect(() => {
    const t = window.setInterval(() => {
      if (voiceActiveRef.current && Date.now() > voiceDeadlineRef.current && voiceCommandRef.current) {
        addLog(`🎤 参与讨论（超时提交）：${voiceCommandRef.current}`)
        voiceActiveRef.current = false
        voiceCommandRef.current = ''
      }
    }, 500)
    return () => window.clearInterval(t)
  }, [addLog])

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      recRef.current?.abort()
    },
    [],
  )

  /** 全局错误捕获：任何未处理异常都写进日志，方便定位崩溃原因 */
  useEffect(() => {
    const onErr = (e: ErrorEvent) => addLog(`💥 页面错误：${e.message} @ ${e.filename}:${e.lineno}`)
    const onRej = (e: PromiseRejectionEvent) => addLog(`💥 未处理异常：${String(e.reason).slice(0, 200)}`)
    window.addEventListener('error', onErr)
    window.addEventListener('unhandledrejection', onRej)
    return () => {
      window.removeEventListener('error', onErr)
      window.removeEventListener('unhandledrejection', onRej)
    }
  }, [addLog])

  /** 测试球的指针交互（与真实讨论室一致的 drag + 双击打开） */
  const onSphereDown = (e: React.PointerEvent, id: string) => {
    e.preventDefault()
    try {
      (e.target as Element).setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件无活动指针 */
    }
    dragRef.current = { id, dx: e.clientX, dy: e.clientY }
  }
  const onSphereMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.dx
    const dy = e.clientY - d.dy
    d.dx = e.clientX
    d.dy = e.clientY
    setSpheres((prev) => prev.map((s) => (s.id === d.id ? { ...s, x: s.x + dx, y: s.y + dy } : s)))
  }
  const onSphereUp = (e: React.PointerEvent, id: string) => {
    // 手动双击判定（与讨论室同一套逻辑：两次轻点 <450ms）
    const now = Date.now()
    const last = lastTapSphereRef.current
    if (last?.id === id && now - last.t < 450) {
      const sp = spheres.find((s) => s.id === id)
      if (sp) {
        setOpened(sp.id)
        addLog(`🔍 双击打开「${sp.label}」内容`)
      }
      lastTapSphereRef.current = null
    } else {
      lastTapSphereRef.current = { id, t: now }
    }
    dragRef.current = null
    void e
  }
  const lastTapSphereRef = useRef<{ id: string; t: number } | null>(null)

  const gestureText = (g: HandGesture) => (g === 'fist' ? '✊ 握拳' : g === 'open' ? '🖐 张开' : g === 'point' ? '👆 指向' : '—')

  return (
    <div className="min-h-screen bg-black text-slate-200">
      {/* 手势光标（全屏跟随） */}
      <div ref={cursorRef} className="pointer-events-none fixed left-0 top-0 z-50 h-8 w-8 opacity-0 transition-opacity duration-150">
        <div className={`h-full w-full rounded-full border-2 ${grabLabel ? 'border-pink-400 bg-pink-400/20' : 'border-white/80 bg-white/10'} shadow-[0_0_18px_rgba(255,255,255,0.5)]`} />
      </div>

      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">手势 & 语音实验室</h1>
            <p className="mt-1 text-sm text-slate-400">
              张开双手唤醒手势控制 · 左手摆动放大 / 右手摆动缩小 · 右手握拳抓取拖动 · 左手握拳双击打开 · 语音唤醒词「小K」
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => (location.href = '/')}>返回主页</Button>
        </header>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* 摄像头面板 */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Camera className="h-4 w-4 text-slate-400" />
              <span className="text-sm font-medium">摄像头 · 手势识别</span>
              <span className={`ml-auto text-xs ${camStatus === 'ready' ? 'text-emerald-400' : camStatus === 'error' ? 'text-red-400' : 'text-slate-500'}`}>
                {camStatus === 'ready' ? '● 已就绪' : camStatus === 'starting' ? '启动中…' : camStatus === 'error' ? '出错' : '未启动'}
              </span>
            </div>
            <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-slate-900">
              <video ref={videoRef} playsInline muted autoPlay className="h-full w-full -scale-x-100 object-cover" />
              <canvas ref={overlayRef} className="absolute inset-0 h-full w-full -scale-x-100" />
              {gestureMode && (
                <div className="absolute inset-x-0 top-0 bg-emerald-500/20 py-1 text-center text-xs font-medium text-emerald-300 backdrop-blur">
                  🙌 手势控制已激活
                </div>
              )}
              {camStatus !== 'ready' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  {camStatus === 'error' ? (
                    <>
                      <p className="text-sm text-red-400">{camError || '无法访问摄像头'}</p>
                      <p className="text-xs text-slate-500">请检查浏览器摄像头权限后重试</p>
                    </>
                  ) : (
                    <Button onClick={startCamera} disabled={camStatus === 'starting'}>
                      <Camera className="mr-2 h-4 w-4" /> {camStatus === 'starting' ? '启动中…' : '启动摄像头'}
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setSwapHands((m) => !m)}>
                <FlipHorizontal2 className="mr-1.5 h-3.5 w-3.5" /> 左右手交换{swapHands ? '（开）' : '（关）'}
              </Button>
              {camStatus === 'ready' && (
                <span className="text-xs text-slate-500">若识别出的左右手与实际相反，点上方交换（不影响光标移动方向）</span>
              )}
            </div>
          </div>

          {/* 状态面板 */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs text-slate-400"><Hand className="h-3.5 w-3.5" /> 左手</div>
                <div className="text-lg font-semibold text-white">{left.present ? gestureText(left.gesture) : '未检测到手'}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {left.swinging ? '↔ 摆动中' : '　'} {gestureMode && left.gesture === 'open' && left.swinging ? '→ 放大' : ''}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs text-slate-400"><Hand className="h-3.5 w-3.5" /> 右手</div>
                <div className="text-lg font-semibold text-white">{right.present ? gestureText(right.gesture) : '未检测到手'}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {right.swinging ? '↔ 摆动中' : '　'} {gestureMode && right.gesture === 'open' && right.swinging ? '→ 缩小' : ''}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                <span>缩放测试（左手摆动放大 / 右手摆动缩小）</span>
                <span className={`font-mono text-sm ${zoomDir === 'in' ? 'text-emerald-400' : zoomDir === 'out' ? 'text-amber-400' : 'text-white'}`}>
                  {zoomLevel.toFixed(2)}× {zoomDir === 'in' ? '🔍+' : zoomDir === 'out' ? '🔍−' : ''}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-slate-500 to-white transition-all duration-150"
                  style={{ width: `${((zoomLevel - 0.5) / 2.5) * 100}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>手势模式：{gestureMode ? '✅ 已唤醒' : '未唤醒（张开双手）'}</span>
                <span>光标：{cursorVisible ? '✅ 跟随手指' : '无'}</span>
                <span>抓取：{grabLabel ? `✅ 抓住「${grabLabel}」` : '—（右手握拳）'}</span>
                <span>双击：{opened ? `✅ 已打开「${INITIAL_SPHERES.find((s) => s.id === opened)?.label}」` : '—（左手握拳）'}</span>
              </div>
            </div>

            {/* 语音面板 */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="mb-2 flex items-center gap-2">
                {voiceListening ? <Mic className="h-4 w-4 text-emerald-400" /> : <MicOff className="h-4 w-4 text-slate-400" />}
                <span className="text-sm font-medium">语音 · 唤醒词「小K」</span>
                <span className={`ml-auto text-xs ${voiceListening ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {voiceListening ? '● 聆听中' : voiceSupported === false ? '❌ 不支持' : '未启动'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {!voiceListening ? (
                  <Button size="sm" variant="outline" onClick={startVoice}><Mic className="mr-1.5 h-3.5 w-3.5" /> 启动语音</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={stopVoice}><MicOff className="mr-1.5 h-3.5 w-3.5" /> 停止</Button>
                )}
                <span className="text-xs text-slate-500">说「小K」唤醒 → 6 秒内说出观点 → 自动提交参与讨论</span>
              </div>
              {voiceError && <p className="mt-2 text-xs text-red-400">{voiceError}</p>}
              {(interim || voiceCommandRef.current) && (
                <p className="mt-2 rounded bg-slate-900 px-3 py-2 text-sm text-slate-300">
                  {interim || voiceCommandRef.current}
                  <span className="ml-2 animate-pulse text-emerald-400">▍</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 测试球区域 */}
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium">关键球测试区 —— 右手握拳抓住拖动，左手握拳双击打开</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSpheres(INITIAL_SPHERES)
                setOpened(null)
              }}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> 重置
            </Button>
          </div>
          <div className="relative h-72 overflow-hidden rounded-lg border border-slate-800/60 bg-black/40">
            {spheres.map((s) => (
              <div
                key={s.id}
                data-lab-sphere={s.label}
                onPointerDown={(e) => onSphereDown(e, s.id)}
                onPointerMove={onSphereMove}
                onPointerUp={(e) => onSphereUp(e, s.id)}
                className="absolute flex cursor-grab touch-none select-none items-center justify-center rounded-full text-sm font-medium text-slate-800 shadow-[0_0_30px_rgba(255,255,255,0.25)] active:cursor-grabbing"
                style={{
                  left: s.x,
                  top: s.y,
                  width: 108,
                  height: 108,
                  background: `radial-gradient(circle at 35% 35%, #e5e7eb, ${s.color} 65%)`,
                }}
              >
                {s.label}
                {opened === s.id && (
                  <div className="absolute left-1/2 top-full z-10 mt-2 w-64 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900/95 p-3 text-left text-xs leading-relaxed text-slate-300 shadow-xl">
                    {s.content}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 日志 */}
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="mb-2 text-sm font-medium">事件日志</div>
          <div className="max-h-48 space-y-1 overflow-y-auto font-mono text-xs text-slate-400">
            {log.length === 0 && <p className="text-slate-600">暂无事件 —— 启动摄像头和语音后操作会记录在这里</p>}
            {log.map((l, i) => (
              <p key={i}><span className="text-slate-600">{l.t}</span>　{l.text}</p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
