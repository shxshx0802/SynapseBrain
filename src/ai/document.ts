// 文档摄入：把拖入的文件提取为可供讨论的文本（或图像）
// 新增格式支持时只改本文件

export interface ExtractedDoc {
  name: string
  kind: 'text' | 'image'
  /** kind=text 时为提取的全文（可能截断）；kind=image 时为 dataURL */
  content: string
  /** 提取出的字符数（展示用） */
  size: number
  truncated: boolean
}

const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|xml|yaml|yml|log|html|css|js|jsx|ts|tsx|py|java|go|rs|c|cpp|h|hpp|sql|sh|bat|env|ini|toml)$/i
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i
const MAX_CHARS = 12000
const MAX_PDF_PAGES = 12

import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  // Vite ?worker 导入：dev/build 都由 Vite 生成 Worker 包装，绕开 workerSrc 的 MIME/路径坑
  const worker = new PdfWorker()
  pdfjs.GlobalWorkerOptions.workerPort = worker
  const loading = pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  // 8 秒超时：worker 异常时给出明确错误而不是永远挂起
  const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('PDF 解析超时，请重试或换用文本文件')), 8000))
  const pdf = await Promise.race([loading, timeout])
  try {
    let text = ''
    for (let i = 1; i <= Math.min(pdf.numPages, MAX_PDF_PAGES); i++) {
      const page = await pdf.getPage(i)
      const tc = await page.getTextContent()
      text += tc.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n'
    }
    return text
  } finally {
    void pdf.cleanup()
    worker.terminate()
  }
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth/mammoth.browser')
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return result.value
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/** 提取失败时抛错，由调用方决定如何提示 */
export async function extractDocument(file: File): Promise<ExtractedDoc> {
  const name = file.name || '未命名文件'

  if (IMAGE_EXT.test(name)) {
    const dataUrl = await readAsDataUrl(file)
    return { name, kind: 'image', content: dataUrl, size: file.size, truncated: false }
  }

  let text: string
  if (/\.pdf$/i.test(name)) {
    text = await extractPdf(file)
  } else if (/\.docx$/i.test(name)) {
    text = await extractDocx(file)
  } else if (TEXT_EXT.test(name) || file.type.startsWith('text/')) {
    text = await file.text()
  } else {
    throw new Error(`暂不支持 .${name.split('.').pop()} 格式，可尝试 PDF / DOCX / 图片 / 纯文本文件`)
  }

  const trimmed = text.trim()
  if (!trimmed) throw new Error('没能从文件中提取到文字内容')
  const truncated = trimmed.length > MAX_CHARS
  return {
    name,
    kind: 'text',
    content: truncated ? trimmed.slice(0, MAX_CHARS) : trimmed,
    size: trimmed.length,
    truncated,
  }
}
