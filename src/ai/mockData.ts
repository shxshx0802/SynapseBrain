// 演示模式数据源：无任何 API key 时驱动讨论与关键球生成
import type { AIRole, RelationType } from '@/shared/types'

export const HUMAN_ID = 'human'

export const INITIAL_ROLES: AIRole[] = [
  { id: 'arch', name: '小构', persona: '架构师 · 技术方向', color: '#38bdf8', budget: 80000, used: 0, downshifted: false, paused: false },
  { id: 'biz', name: '小商', persona: '商业顾问 · 商业方向', color: '#f472b6', budget: 80000, used: 0, downshifted: false, paused: false },
  { id: 'risk', name: '小稳', persona: '风控官 · 风险方向', color: '#fbbf24', budget: 80000, used: 0, downshifted: false, paused: false },
]

export const WELCOME: Record<string, string> = {
  arch: '我是小构，从技术架构方向介入讨论。我会把关键的技术判断凝结成关键球，拖到我的球旁边看看会发生什么。',
  biz: '我是小商，盯商业化和增长路径。我凝结的关键球会偏市场与收入侧。',
  risk: '我是小稳，负责唱反调。任何方案我都会先找它的裂缝，我的关键球 often 是约束条件。',
}

export const MESSAGE_POOLS: Record<string, string[]> = {
  arch: [
    '建议核心状态用事件溯源，讨论过程本身就是一条可回放的事件流，正好契合我们的产品定位。',
    '融球效果用 Canvas 距离场渲染就够了，WebGL 可以留到 V2，先保证移动端帧率。',
    'Provider 抽象层必须第一天就做，否则三家模型厂商的 SDK 会把业务代码弄脏。',
    '本地优先存储我选 SQLite + 文件系统，画布状态可以序列化成 JSON snapshot。',
    '关键球的融球渲染要开独立图层，别让滤镜作用到文字标签上，不然字会糊。',
    '手势控制用 Pointer Events 统一鼠标和触屏，摄像头手势留到实验性功能开关后面。',
    'WebSocket 断线重连后需要事件流对齐，不然两个 AI 的发言顺序会乱。',
    '我建议每个方向（Thread）一个独立的 token 预算桶，超了自动降档换小模型。',
  ],
  biz: [
    '这个产品的付费点应该在「团队版」，单人用户很难为协同讨论买单。',
    '关键球如果支持导出成关系图谱，就能变成企业知识资产，这是续费理由。',
    '竞品已经在做 AI 会议纪要了，我们差异化就在「多方向并行 + 可视化关系」上。',
    'MVP 别贪大，先把「两个 AI 吵架」做成最好玩的 demo，病毒传播靠这个。',
    '额度管家其实是卖点不是成本：CFO 能看到每个 AI 花了多少钱，这场景企业会爱。',
    '定价可以参考席位 + AI 用量双轨，重度用户不怕贵，怕的是不可控。',
    '手势交互是个记忆点，发布会上让人拖两个球碰在一起，融掉的瞬间全场会记住我们。',
    '企业市场在意数据合规，本地优先这个设计红线要放在官网首屏。',
  ],
  risk: [
    '提醒一下：三个 AI 并行讨论，token 消耗是线性的，预算机制没做好就是烧钱机器。',
    '融球 + 震动的强反馈可能触发部分用户的前庭不适，「减少动态效果」开关是合规要求不是可选项。',
    '文件拖入即解析，恶意文档投毒怎么防？上传通道要加内容扫描。',
    '摄像头手势涉及隐私，默认必须关闭，且视频流不能离开本地设备。',
    'AI 自动生成的「关系解读」如果胡说，用户会立刻失去信任，关键球关系需要标注置信度。',
    '多 AI 意见冲突时界面不能和稀泥，要强制展示分歧而不是自动折中。',
    '额度降档策略要防抖动：刚降档又回升会导致模型来回切换，体验很差。',
    '别忘了无障碍：融球效果纯视觉，视障用户需要等价的文字/语音反馈通道。',
  ],
}

export const SPHERE_LABEL_POOLS: Record<string, string[]> = {
  arch: ['事件溯源架构', '本地优先存储', 'Provider 抽象层', '距离场融球渲染', 'Pointer 手势统一'],
  biz: ['企业团队版付费', '关系图谱即资产', '双轨定价模型', '差异化记忆点'],
  risk: ['额度防抖动降档', '减少动态效果红线', '关系解读置信度', '上传通道安全扫描'],
}

/** 与 SPHERE_LABEL_POOLS 同索引：每颗球凝结的原始讨论内容（双击球时查看） */
export const SPHERE_CONTENT_POOLS: Record<string, string[]> = {
  arch: [
    '建议核心状态用事件溯源，讨论过程本身就是一条可回放的事件流，正好契合产品定位。后续任何方向的修改都能追溯来源。',
    '数据默认留在本地：SQLite 存会话元数据，文件内容留在用户文件系统。云端同步只做可选项，不上传原始讨论内容。',
    '三家模型厂商的 SDK 差异用统一接口隔离：业务代码只调 provider.chat()，换厂商不改业务。新增厂商只写一个适配文件。',
    '融球用 Canvas 2D 距离场 + SVG goo 滤镜就能跑满 60 帧，WebGL 留给 V2 的多球大规模场景，避免过早优化。',
    '鼠标、触屏、手写笔统一走 Pointer Events，双指捏合缩放与拖拽互不冲突；摄像头手势作为实验功能默认关闭。',
  ],
  biz: [
    '个人用户付费意愿低，团队版按席位收费才是收入主体：协作场景里 AI 讨论产出的决策记录本身就是工作资产。',
    '讨论中沉淀的关键球和关系边可以导出成企业知识图谱，形成续费理由：数据越用越厚，迁出成本越高。',
    '席位费 + AI 用量费双轨：轻度团队按席位，重度用量单独计量，CFO 能看到每个 AI 每方向的消耗明细。',
    '市面上 AI 工具都在做「单助手问答」，「多方向并行 + 概念可视化碰撞」是我们最容易被记住、也最难被抄走的点。',
  ],
  risk: [
    '额度刚降档又回升会导致模型来回切换、回答风格忽长忽短。降档应带滞回区间：低于 20% 降档，回升到 35% 才恢复。',
    '融球、震动、光波都属强动态反馈，可能引发前庭不适。减少动态效果开关必须默认易达，且关闭后信息不丢失。',
    'AI 口播的两球关系可能是幻觉。每条关系解读应标注置信度与来源，低置信度要 visually 区分，允许人类一键否决。',
    '文件拖入即解析意味着恶意文档可以投毒提示词。上传通道需要内容扫描，且文件文本进模型前要做注入特征过滤。',
  ],
}

export const RELATION_LABEL: Record<RelationType, string> = {
  supports: '支撑',
  contradicts: '冲突',
  causes: '因果',
  analogy: '类比',
}

export const RELATION_TEMPLATES: Record<RelationType, string[]> = {
  supports: [
    '{A} 是 {B} 的地基——先把前者做扎实，后者才立得住。',
    '{A} 为 {B} 提供了直接支撑，两者应该绑定推进。',
  ],
  contradicts: [
    '{A} 与 {B} 正面冲突：两者的前提不能同时成立，需要拍板取舍。',
    '{A} 会削弱 {B} 的基础，这是当前最大的分歧点。',
  ],
  causes: [
    '从因果上看，{A} 直接触发了 {B}，动前者必然动后者。',
    '{A} 是 {B} 的前置条件，没有它后者大概率不成立。',
  ],
  analogy: [
    '{A} 与 {B} 结构同构，可以用同一套方案互相借鉴。',
    '{A} 是 {B} 在另一个领域的镜像，类比迁移成本低。',
  ],
}

const TYPE_ORDER: RelationType[] = ['supports', 'contradicts', 'causes', 'analogy']

let counter = 0
export function makeId(): string {
  counter += 1
  return `${Date.now().toString(36)}-${counter.toString(36)}`
}

/** 由两个球的内容决定关系类型（确定性，同一对球结论稳定） */
export function relationTypeOf(aLabel: string, bLabel: string): RelationType {
  const s = aLabel + '⟂' + bLabel
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return TYPE_ORDER[h % TYPE_ORDER.length]
}
