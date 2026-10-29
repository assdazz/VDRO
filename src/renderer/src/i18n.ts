import type { Language } from '@shared/types'

const EN: Record<string, string> = {
  '界面': 'Interface',
  '输出': 'Output',
  '预览': 'Preview',
  '数据': 'Data',
  '快捷键': 'Shortcuts',
  '关于': 'About',
  '设置': 'Settings',
  '语言 / Language': 'Language',
  '字体大小 / Font size': 'Font size',
  '中文': 'Chinese',
  '小 / Small': 'Small',
  '标准 / Normal': 'Normal',
  '大 / Large': 'Large',
  '特大 / Extra large': 'Extra large',
  '界面缩放': 'Interface scale',
  '缩小界面': 'Decrease interface scale',
  '放大界面': 'Increase interface scale',
  '恢复全部默认设置': 'Restore all defaults',
  '重置界面布局': 'Reset layout',
  '素材栏默认收起': 'Collapse media library by default',
  '启动时恢复拖动布局': 'Restore resized layout on startup',
  '半透明': 'Translucent',
  '让窗口透出桌面或后方软件的颜色；需要 Windows 透明窗口支持。':
    'Let the desktop show through; requires Windows transparency support.',
  '强调色': 'Accent color',
  '霓虹黄': 'Neon yellow',
  '冰蓝': 'Ice blue',
  '荧光绿': 'Neon green',
  '电光紫': 'Electric purple',
  '主题': 'Theme',
  '主题颜色': 'Theme color',
  '深色': 'Dark',
  '纯黑': 'OLED black',
  '白天': 'Light',
  '亚克力': 'Acrylic',
  '紫罗兰': 'Violet',
  '青绿': 'Teal',
  '玫瑰': 'Rose',
  '琥珀': 'Amber',
  '石墨': 'Graphite',
  '输出默认值': 'Output defaults',
  '影响下一次提取；当前已提取片段不会改变。':
    'Applies to the next extraction; existing clips are unchanged.',
  '默认输出格式': 'Default format',
  '默认输出音质': 'Default quality',
  '采样率': 'Sample rate',
  '声道': 'Channels',
  '单声道': 'Mono',
  '立体声': 'Stereo',
  '保存方式': 'Save mode',
  '每次询问': 'Ask every time',
  '固定目录': 'Fixed folder',
  '默认保存目录': 'Default save folder',
  '默认保存文件夹': 'Default save folder',
  '选择文件夹': 'Choose folder',
  '清除': 'Clear',
  '尚未选择目录': 'No folder selected',
  '选择目录': 'Choose folder',
  '提取后自动选中新片段': 'Select new clip after extraction',
  '文件名模板': 'Filename template',
  '源文件名': 'Source name',
  '起始时间': 'Start time',
  '结束时间': 'End time',
  '时长': 'Duration',
  '日期': 'Date',
  '时间': 'Time',
  '扩展名': 'Extension',
  '数据目录': 'Data folder',
  '版本': 'Version',
  '关于 VDRO': 'About VDRO',
  '临时文件与数据': 'Temporary files and data',
  '启动时清理临时提取文件': 'Clean temporary extracted files at startup',
  '素材库跨启动保留': 'Keep media library between sessions',
  '已提取音频跨启动保留': 'Keep extracted audio between sessions',
  '删除操作前确认': 'Confirm before deleting',
  '波形缓存上限': 'Waveform cache limit',
  '不限制': 'Unlimited',
  '清理临时提取文件': 'Clear temporary extracted files',
  '清理波形缓存': 'Clear waveform cache',
  '清理中…': 'Clearing…',
  '临时文件保留时间': 'Temporary retention',
  '临时文件总大小上限': 'Temporary size limit',
  '不按时间删除': 'Never delete by age',
  '打开数据目录': 'Open data folder',
  '默认预览音量': 'Default preview volume',
  '默认静音': 'Mute by default',
  '预览音量': 'Preview volume',
  '静音': 'Mute',
  '取消静音': 'Unmute',
  '窗口行为': 'Window behavior',
  '记住窗口大小和位置': 'Remember window size and position',
  '启动时最大化': 'Start maximized',
  '窗口置顶': 'Always on top',
  '预览与播放': 'Preview and playback',
  '默认预览分辨率': 'Default preview resolution',
  '默认帧率': 'Default frame rate',
  '前后快进时长': 'Seek step',
  '自定义': 'Custom',
  '自定义时长（秒）': 'Custom step (seconds)',
  '秒': 's',
  '预览选区默认循环': 'Loop preview selection',
  '提取音频播放时同步视频': 'Sync video with extracted audio',
  '关闭后只播放提取音频。': 'When off, only extracted audio plays.',
  '界面与布局': 'Interface and layout',
  '帧率': 'Frame rate',
  '跟随源': 'Follow source',
  '预览分辨率': 'Preview resolution',
  '保存': 'Save',
  '保存中': 'Saving',
  '打开设置': 'Open settings',
  '关闭设置': 'Close settings',
  '关闭': 'Close',
  '导入素材': 'Import media',
  '提取': 'Extract',
  '整段提取': 'Extract full',
  '播放': 'Play',
  '暂停': 'Pause',
  '播放 / 暂停': 'Play / Pause',
  '设为起始点': 'Set in point',
  '设为结束点': 'Set out point',
  '后退': 'Back',
  '前进': 'Forward',
  '波形缩放': 'Waveform zoom',
  '缩小': 'Zoom out',
  '放大': 'Zoom in',
  '重置': 'Reset',
  '预览播放进度': 'Preview progress',
  '视频预览播放进度': 'Video preview progress',
  '预览选区': 'Preview selection',
  '选区预览': 'Preview selection',
  '循环': 'Loop',
  '音频轨道': 'Audio track',
  '视频预览': 'Video preview',
  '音频预览': 'Audio preview',
  '已提取音频': 'Extracted audio',
  '等待媒体': 'Waiting for media',
  '片段时间': 'Clip time',
  '片段时长': 'Clip duration',
  '起始时间点': 'Start time',
  '结束时间点': 'End time',
  '素材数量': 'Media',
  '素材数量：': 'Media:',
  '素材数量:': 'Media:',
  'SPACE 播放 · I / O 设起止': 'SPACE Play · I / O Set in/out',
  '导入音频或视频文件以开始': 'Import audio or video to begin',
  '拖入 MP3、WAV、FLAC、M4A 或 MP4、MOV、MKV、WebM。':
    'Drop MP3, WAV, FLAC, M4A, MP4, MOV, MKV, or WebM.',
  '波形上拖出选区，播放中也能导出。':
    'Drag a selection on the waveform; export while playing.',
  '选择文件': 'Choose file',
  '素材会出现在这里': 'Your media will appear here',
  '拖入音频或视频，或点击上方导入': 'Drop audio/video, or import above',
  '素材': 'Media',
  '导入媒体后，在波形上拖动即可创建片段。':
    'After importing, drag on the waveform to create a clip.',
  '在波形上选择范围，点击时间轴右侧“提取”':
    'Select a range on the waveform, then click Extract.',
  '还没有提取音频': 'No extracted audio yet',
  '此处显示波形图': 'Waveform appears here',
  '波形尚未生成': 'Waveform is not ready',
  '拖动波形创建选区 · 拖两端调整': 'Drag on the waveform to select; drag edges to trim',
  '正在读取媒体并生成波形…': 'Reading media and generating waveform…',
  '正在导出': 'Exporting',
  '导出失败': 'Export failed',
  '导出完成': 'Export complete',
  '已取消导出': 'Export cancelled',
  '提取中…': 'Extracting…',
  '从素材栏移除': 'Remove from library',
  '收起视频预览': 'Collapse video preview',
  '展开视频预览': 'Expand video preview',
  '收起音频预览': 'Collapse audio preview',
  '展开音频预览': 'Expand audio preview',
  '收起已提取音频': 'Collapse extracted audio',
  '展开已提取音频': 'Expand extracted audio',
  '收缩素材栏': 'Collapse media library',
  '展开素材栏': 'Expand media library',
  '调整视频预览高度': 'Resize video preview',
  '调整视频预览与音频预览高度': 'Resize video and audio preview',
  '调整音频预览高度': 'Resize audio preview',
  '调整音频预览与已提取音频高度': 'Resize audio preview and extracted audio',
  '调整音频预览与片段时间宽度': 'Resize audio preview and clip time',
  '左右移动音频预览': 'Move audio preview horizontally',
  '原生': 'Native',
  '无损': 'Lossless',
  '无损 / 精确': 'Lossless / precise',
  '无损压缩': 'Lossless compressed',
  '兼容 / 分享': 'Compatible / share',
  'AAC / 通用': 'AAC / common',
  '输出格式': 'Format',
  '输出音质': 'Quality',
}

const PATTERNS: Array<[RegExp, string]> = [
  [/^已提取 (.+) 音频$/, 'Extracted $1 of audio'],
  [/^已保存：(.+)$/, 'Saved: $1'],
  [/^已从素材栏移除：(.+)$/, 'Removed from library: $1'],
  [/^正在导出 (\d+)%$/, 'Exporting $1%'],
  [/^(\d+) 个素材文件已失效，已从素材库跳过$/, '$1 media files are missing and were skipped'],
  [/^前进 (\d+) 秒$/, 'Forward $1 s'],
  [/^后退 (\d+) 秒$/, 'Back $1 s'],
  [/^该按键已被“(.+)”使用$/, 'Shortcut already used by “$1”'],
  [/^确定从素材栏移除“(.+)”吗？源文件不会被删除。$/, 'Remove “$1” from the library? The source file is kept.'],
  [/^确定删除已提取音频“(.+)”吗？$/, 'Delete extracted clip “$1”?'],
  [/^源素材：(.+)$/, 'Source: $1'],
  [/^(\d+) 秒$/, '$1 s'],
]

function preserveWhitespace(original: string, translated: string): string {
  const leading = original.match(/^\s*/)?.[0] ?? ''
  const trailing = original.match(/\s*$/)?.[0] ?? ''
  return `${leading}${translated}${trailing}`
}

export function translateUiText(input: string, language: Language): string {
  if (language !== 'en-US') return input
  const core = input.trim()
  if (!core) return input

  const exact = EN[core]
  if (exact) return preserveWhitespace(input, exact)

  for (const [pattern, replacement] of PATTERNS) {
    if (pattern.test(core)) {
      return preserveWhitespace(input, core.replace(pattern, replacement))
    }
  }
  return input
}

const textOriginals = new WeakMap<Text, string>()
const attributeOriginals = new WeakMap<Element, Map<string, string>>()

function translateNode(node: Node, language: Language): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text
    const current = text.nodeValue ?? ''
    const original = textOriginals.get(text)

    if (language === 'zh-CN') {
      if (original !== undefined && current !== original) {
        if (/[\u4e00-\u9fff]/.test(current)) {
          textOriginals.set(text, current)
        } else {
          text.nodeValue = original
        }
      }
      return
    }

    if (original === undefined) {
      if (!/[\u4e00-\u9fff]/.test(current)) return
      textOriginals.set(text, current)
    } else if (current !== original && /[\u4e00-\u9fff]/.test(current)) {
      textOriginals.set(text, current)
    }

    const next = translateUiText(textOriginals.get(text) ?? current, language)
    if (current !== next) text.nodeValue = next
    return
  }

  if (!(node instanceof Element)) return
  for (const attribute of ['title', 'aria-label', 'placeholder']) {
    const current = node.getAttribute(attribute)
    if (!current) continue
    let originals = attributeOriginals.get(node)
    if (!originals) {
      originals = new Map()
      attributeOriginals.set(node, originals)
    }
    const original = originals.get(attribute)

    if (language === 'zh-CN') {
      if (original !== undefined && current !== original) {
        node.setAttribute(attribute, original)
      }
      continue
    }

    if (original === undefined) {
      if (!/[\u4e00-\u9fff]/.test(current)) continue
      originals.set(attribute, current)
    } else if (current !== original && /[\u4e00-\u9fff]/.test(current)) {
      originals.set(attribute, current)
    }

    const next = translateUiText(originals.get(attribute) ?? current, language)
    if (current !== next) node.setAttribute(attribute, next)
  }
}

export function translateDom(root: Node, language: Language): void {
  translateNode(root, language)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    translateNode(node, language)
    node = walker.nextNode()
  }
}
