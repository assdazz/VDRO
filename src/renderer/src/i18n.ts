import type { Language } from '@shared/types'

const EN: Record<string, string> = {
  '界面': 'Interface',
  '输出': 'Output',
  '预览': 'Preview',
  '数据': 'Data',
  '快捷键': 'Shortcuts',
  '首页导航': 'Home navigation',
  '新建项目': 'New project',
  '我的项目': 'My projects',
  '素材库': 'Media library',
  '最近动态': 'Recent activity',
  '快捷键提示': 'Keyboard shortcuts',
  '还没有项目': 'No projects yet',
  '点击“新建项目”开始。': 'Select New project to get started.',
  '暂无动态': 'No recent activity',
  '创建项目': 'Create project',
  '项目已创建': 'Project created',
  '打开项目': 'Opened project',
  '项目名称': 'Project name',
  '删除项目': 'Delete project',
  '请在当前音频任务完成后删除项目。': 'Wait for the current audio task to finish before deleting the project.',
  '确定删除此项目及其编辑记录吗？源素材和已另存的文件会保留。': 'Delete this project and its edits? Source media and saved exports will be kept.',
  '无法删除项目，请重试。': 'Unable to delete the project. Try again.',
  '移除': 'Remove',
  '确定移除此素材及其编辑记录吗？': 'Remove this media item and its edits?',
  '工作区': 'Workspace',
  '请在当前音频任务完成后清理临时文件。': 'Wait for the current audio task to finish before clearing temporary files.',
  '请在当前音频任务完成后切换项目。': 'Wait for the current audio task to finish before switching projects.',
  '渐变范围无效': 'Invalid fade range',
  '恢复位置已有片段，请先移开后重试。': 'A clip occupies the restore position. Move it first, then retry.',
  '恢复后片段数量超出上限，请先移除部分片段。': 'Restoring would exceed the clip limit. Remove some clips first.',
  '替换素材时长不足，无法恢复原片段。': 'The replacement is too short to restore the original clips.',
  '重新定位': 'Locate file',
  '重试': 'Retry',
  '重新选择源文件可恢复片段、位置和调整参数。': 'Locate the source file to restore clips, positions, and adjustments.',
  '待恢复素材': 'Media to restore',
  '正在恢复': 'Restoring',
  '保存失败': 'Save failed',
  '已保存': 'Saved',
  '未命名草稿': 'Untitled draft',
  '恢复未命名草稿': 'Resume untitled draft',
  '分割保留原片段的渐入渐出曲线。': 'Splitting preserves the original clip’s fade envelope.',
  '重置渐入渐出': 'Reset fades',
  '无法保存项目，请重试。': 'Unable to save the project. Try again.',
  '素材库为空': 'The media library is empty',
  '无法打开素材，请重试。': 'Unable to open the media. Try again.',
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
  '旧版本': 'Legacy',
  '新版本': 'New',
  '配色模式': 'Color scheme',
  '主题颜色': 'Theme color',
  '深色': 'Dark',
  '纯黑': 'OLED black',
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
  '时间线工具': 'Timeline tools',
  '选择工具': 'Selection tool',
  '选择': 'Select',
  '分割工具': 'Split tool',
  '分割': 'Split',
  '在播放头处分割': 'Split at playhead',
  '点击波形分割音频': 'Click the waveform to split the audio',
  '在此分割片段': 'Split this clip',
  '编辑工具': 'Editing tools',
  '删除当前选区': 'Clear selected range',
  '撤销': 'Undo',
  '重做': 'Redo',
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
  '音频时间线': 'Audio timeline',
  '展开音频时间线': 'Expand audio timeline',
  '收起音频时间线': 'Collapse audio timeline',
  '调整右侧栏宽度': 'Resize right sidebar',
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

Object.assign(EN, {
  "素材列表": "Media library",
  "添加素材": "Add media",
  "原生预览": "Native preview",
  "原生预览（跟随源）": "Native preview (follow source)",
  "原视频分辨率：": "Source video resolution:",
  "原视频帧率：": "Source video frame rate:",
  "帧": " fps",
  "按住左键拖动框选 · 拖两端微调": "Drag to select a range · Drag the edges to fine-tune",
  "平移": "Pan",
  "当前波形缩放倍率": "Current waveform zoom",
  "调整已提取音频高度": "Resize extracted audio panel",
  "原生（": "Native (",
  "在波形上选择范围，点击“提取”即可生成片段": "Select a waveform range and click Extract to create a clip",
  "音频调整": "Audio adjustment",
  "删除": "Delete",
  "复制": "Copy",
  "剪切": "Cut",
  "倒放": "Reverse",
  "倒放参数无效": "Invalid reverse setting",
  "片段操作": "Clip actions",
  "取消": "Cancel",
  "打开文件夹": "Open folder",
  "音频或视频文件": "Audio or video files",
  "工作页面": "Workspace",
  "音频工作台": "Audio workspace",
  "首页": "Home",
  "素材文件夹": "Media folder",
  "选择素材文件夹": "Choose media folder",
  "更改": "Change",
  "更改素材文件夹": "Change media folder",
  "撤消": "Clear",
  "撤消素材文件夹选择": "Clear media folder selection",
  "无法选择素材文件夹，请重试。": "Could not select a media folder. Try again.",
  "选择片段，剪辑并提取音频。": "Select, cut and extract audio segments.",
  "调整音高、音量和淡入淡出。": "Adjust pitch, volume and fades.",
  "音频剪辑": "Audio cutting",
  "音频剪辑与音频调整共用。默认格式和音质同步到两页，页面内可单独修改；采样率、声道、保存方式和命名规则用于后续输出，已有结果不会改变。": "Shared by both pages. Default format and quality update both pages and can be overridden locally. Sample rate, channels, saving and naming apply to future outputs; existing results stay unchanged.",
  "点击下方按钮追加到模板末尾，按点击顺序组合，自动用 _ 分隔。": "Click tokens below to append them in order, separated by underscores.",
  "清空": "Clear",
  "恢复默认": "Restore defaults",
  "音频调整默认值": "Audio adjustment defaults",
  "共振峰和削波保护用于下次导入音频或点击“恢复参数”；标记吸附默认开关用于下次导入，吸附距离立即生效。": "Formant preservation and clipping protection apply on the next import or when restoring parameters. The snapping default applies on import; snapping distance takes effect immediately.",
  "默认保持人声共振峰": "Preserve vocal formants by default",
  "声音变高，但尽量保留原来的嗓音特点。若想要保留人声特点，可以打开此选项。": "Raises the pitch while retaining the original vocal character as much as possible. Enable this option to preserve vocal characteristics.",
  "默认防止音量削波": "Prevent clipping by default",
  "降低增益过大导致的过载失真风险。": "Reduces the risk of distortion from excessive gain.",
  "默认开启标记吸附": "Enable marker snapping by default",
  "选区边缘拖动到标记附近时自动对齐。": "Selection edges snap to nearby markers while dragging.",
  "标记吸附距离（像素）": "Marker snapping distance (pixels)",
  "标记吸附距离": "Marker snapping distance",
  "共振峰和削波保护用于新片段或点击“恢复参数”时，吸附距离即时生效。": "Formant preservation and clipping protection apply to new clips or when restoring parameters. Snapping distance takes effect immediately.",
  "默认开启吸附对齐": "Enable snapping by default",
  "裁剪边缘拖到其他片段边缘或音高标记附近时自动对齐。": "Trim boundaries snap to nearby clip edges and pitch markers.",
  "移动或裁剪片段时会吸附到片段边缘与播放头。裁剪时也可吸附到音高标记。": "Moving or trimming clips snaps to clip edges and the playhead. Trimming also snaps to pitch markers.",
  "吸附距离（像素）": "Snapping distance (pixels)",
  "吸附距离": "Snapping distance",
  "新建预览时使用；也可在预览菜单中临时切换。": "Used for new previews; can be overridden in the preview menu.",
  "启动时预览不播放声音，仍可在音频预览栏临时取消。": "Mute previews at startup; unmute temporarily in the audio preview panel.",
  "下次启动时恢复上次的位置；副屏移除后会自动回退到可用屏幕。": "Restore the previous window position on startup, falling back to an available screen if needed.",
  "只处理临时提取目录；不会删除你通过“保存”另存到其他目录的文件。": "Only cleans temporary extracted files; files saved to other folders are kept.",
  "只记录文件路径，不复制源文件；已提取音频跨启动保留依赖此项。": "Stores file paths without copying sources. Required to keep extracted audio between sessions.",
  "需要素材库保留源文件路径；否则重启后会清空提取列表。": "Requires the media library to retain source paths; otherwise the extracted list resets on restart.",
  "未开启素材库跨启动保留时，重启后已提取音频列表会自动清空。": "The extracted audio list resets on restart unless the media library is kept between sessions.",
  "删除已提取音频、移除素材或清理文件时询问。": "Ask before deleting clips, removing media or clearing files.",
  "会删除所有已提取音频临时文件和记录。": "Deletes all temporary extracted audio files and records.",
  "会删除磁盘上的波形缓存，下次重新生成。": "Deletes waveform caches from disk; they will be regenerated when needed.",
  "点击按键框后按下新按键，Esc 取消。": "Click a shortcut and press a new key. Press Esc to cancel.",
  "按下按键…": "Press a key…",
  "恢复默认快捷键": "Restore default shortcuts",
  "确定要恢复所有设置为默认值吗？": "Restore all settings to their defaults?",
  "正在准备纯音频试听…": "Preparing audio preview…",
  "该文件没有音轨": "This file has no audio tracks",
  "正在生成音频波形…": "Generating waveform…",
  "已启用实时试听，播放时修改参数即可听到变化。": "Live preview enabled. Change parameters during playback to hear the result.",
  "请检查范围：渐入与渐出总时长不能超过片段时长": "The combined fade-in and fade-out duration must not exceed the clip duration",
  "已使用相同参数生成的结果": "Reused the result with identical parameters",
  "正在生成调整结果…": "Rendering adjusted audio…",
  "音频调整模式": "Audio adjustment mode",
  "单轨调整": "Single track",
  "多轨混音": "Multitrack mix",
  "框选片段": "Select clip range",
  "在波形上按住左键框选，松开后保留框内音频。": "Drag across a clip waveform and release to keep the selected audio.",
  "将保留": "Range to keep",
  "已保留": "Range kept",
  "保存片段": "Save selected clip",
  "音频已保存": "Audio saved",
  "添加到时间线": "Add to timeline",
  "从左侧拖入素材": "Drag a file here from the library",
  "正在导入素材…": "Importing media…",
  "移除片段": "Remove clip",
  "确定移除这个片段吗？": "Remove this clip?",
  "该位置与同一轨道上的片段重叠。": "This position overlaps a clip on the same track.",
  "添加音轨": "Add tracks",
  "轨道": "Track",
  "轨道名称": "Track name",
  "新轨道": "New track",
  "忽略音轨": "Ignore track",
  "恢复音轨": "Restore track",
  "静音整条轨道": "Mute entire track",
  "取消整轨静音": "Unmute track",
  "静音片段": "Mute clip",
  "锁定轨道": "Lock track",
  "解锁轨道": "Unlock track",
  "轨道已锁定。": "The track is locked.",
  "已导入素材，解锁轨道后可切换。": "Media imported. Unlock the track to switch to it.",
  "调整侧栏": "Adjustment sidebar",
  "从素材栏拖入素材": "Drag media from the library",
  "移除音轨": "Remove track",
  "确定移除这条音轨吗？": "Remove this track?",
  "在此波形定位播放头": "Seek on this waveform",
  "拖动播放头": "Drag playhead",
  "添加或拖入多个素材，分别调整各轨后合成一条音频。": "Add or drop multiple files, adjust each track, and combine them into one audio file.",
  "试听混音": "Preview mix",
  "实时混音试听": "Play live mix",
  "暂停混音": "Pause mix",
  "实时试听选中片段": "Play selected clip",
  "暂停片段试听": "Pause clip preview",
  "混音播放进度": "Mix playback position",
  "试听音量": "Preview volume",
  "播放速度": "Playback speed",
  "吸附对齐": "Snap to align",
  "拖动裁剪片段起点": "Drag to trim the clip start",
  "拖动裁剪片段终点": "Drag to trim the clip end",
  "无法读取混音试听素材。": "Unable to read source audio for the mix preview.",
  "实时混音处理失败。": "Live mix processing failed.",
  "保存混音": "Save mix",
  "正在读取音轨并生成波形…": "Reading tracks and generating waveforms…",
  "正在生成混音…": "Rendering mix…",
  "混音已保存": "Mix saved",
  "混音参数已修改，点击试听混音更新。": "Mix settings changed. Select Preview mix to update.",
  "轨道参数": "Track settings",
  "添加音轨后可编辑轨道参数。": "Add a track to edit its settings.",
  "混音起点（秒）": "Timeline start (s)",
  "混音轨道数量无效": "Invalid number of mix tracks",
  "轨道位置无效": "Invalid track position",
  "缺少音频调整参数": "Audio adjustment settings are missing",
  "音高标记超出音频范围": "A pitch marker is outside the audio range",
  "音高标记参数无效": "Invalid pitch marker settings",
  "处理范围无效": "Invalid audio range",
  "找不到音轨": "Audio track not found",
  "输出参数无效": "Invalid output settings",
  "调整任务无效": "Invalid adjustment job",
  "任务已在运行": "This job is already running",
  "媒体文件已失效，请重新导入": "The media is unavailable. Import it again.",
  "调整参数无效": "Invalid adjustment settings",
  "调整开关无效": "Invalid adjustment switches",
  "音频调整参数超出范围": "Audio adjustment settings are out of range",
  "渐入与渐出总时长不能超过处理范围": "The combined fades must fit the clip duration",
  "渐变曲线无效": "Invalid fade curve",
  "标记间隔至少 0.01 秒": "Markers must be at least 0.01 s apart",
  "片段太短，至少需要 20ms": "A clip must be at least 20 ms long",
  "无损编码": "Lossless encoding",
  "已生成可保存的结果，可选择试听核对导出音质。": "Result ready. Preview it to check the output quality, then save it.",
  "已保存：": "Saved:",
  "最多支持 128 个标记": "A maximum of 128 markers is supported",
  "导入音频 / 视频音轨": "Import audio / video soundtrack",
  "拖入文件，或从“音频剪辑”的已提取片段点击“音频调整”。此页只播放音频。": "Drop a file here, or choose Audio adjustment on an extracted clip. This page plays audio only.",
  "重置缩放": "Reset zoom",
  "添加标记": "Add marker",
  "标记吸附": "Snap to markers",
  "导入后显示音频波形": "Import audio to display its waveform",
  "起点（秒）": "Start (s)",
  "终点（秒）": "End (s)",
  "实时试听": "Live preview",
  "原音": "Original",
  "试听原音": "Play original",
  "暂停原音": "Pause original",
  "已生成结果": "Rendered result",
  "正在试听之前生成的结果": "Previewing a previously rendered result",
  "原生码率（未获取时使用 192 kbps）": "Source bitrate (192 kbps if unavailable)",
  "保存修改音频": "Save adjusted audio",
  "试听文件不可用，请重新导入或生成。": "Preview file unavailable. Import or render it again.",
  "调整结果": "Adjusted results",
  "生成结果后可试听、保存或删除。原文件不会被修改。": "Preview, save or delete rendered results. The original file is kept.",
  "秒 ·": "s ·",
  "选择试听": "Preview",
  "调整参数": "Adjustment parameters",
  "标记音高（半音）": "Marker pitch (semitones)",
  "基础音调（半音）": "Base pitch (semitones)",
  "音调半音数": "Pitch in semitones",
  "重置音调": "Reset pitch",
  "音高标记": "Pitch markers",
  "点击“添加标记”在播放头创建标记。点击波形上的数字选择标记，上方音高调整实时生效。": "Click Add marker to create a marker at the playhead. Select its number on the waveform, then adjust its pitch in real time.",
  "标记时间（秒）": "Marker time (s)",
  "标记": "Marker",
  "清除全部标记": "Clear all markers",
  "保持人声共振峰": "Preserve vocal formants",
  "防止音量削波": "Prevent clipping",
  "音量（dB）": "Gain (dB)",
  "重置音量": "Reset gain",
  "渐入（秒）": "Fade in (s)",
  "渐入时长": "Fade-in duration",
  "渐入控制柄": "Fade-in slider",
  "渐出（秒）": "Fade out (s)",
  "渐出时长": "Fade-out duration",
  "渐出控制柄": "Fade-out slider",
  "渐变曲线": "Fade curve",
  "线性": "Linear",
  "平滑": "Smooth",
  "指数": "Exponential",
  "恢复参数": "Restore parameters",
  "取消处理": "Cancel processing",
  "参数和标记修改会自动切回实时试听，保持速度和时长。保存前生成结果；实时试听与导出音色可能略有差别，可试听已生成结果核对。": "Parameter and marker edits switch back to live preview, preserving speed and duration. Render before saving; live preview and export may sound slightly different. Preview the rendered result to compare.",
  "该文件没有音频轨道，无法提取音频": "This file has no audio tracks to extract",
  "源素材不存在或同名素材无法区分，请重新导入原文件": "Source missing or ambiguous. Import the original file again.",
  "已删除提取片段": "Extracted clip deleted",
  "已恢复全部默认设置": "All settings restored to defaults",
  "已重置界面布局": "Layout reset",
  "确定清理全部临时提取文件吗？这不会删除已经另存的文件。": "Clear all temporary extracted files? Saved copies will be kept.",
  "已清理所有临时提取文件": "Temporary extracted files cleared",
  "确定清理全部波形缓存吗？下次打开素材会重新生成。": "Clear all waveform caches? They will be regenerated when media is opened.",
  "已清理波形缓存": "Waveform cache cleared",
  "无法读取本地 Rubber Band 组件": "Unable to load the local Rubber Band component",
  "Rubber Band 初始化超时": "Rubber Band initialization timed out",
  "Rubber Band 音频线程初始化失败": "Rubber Band audio thread initialization failed",
  "实时试听处理失败，请重新打开音频调整页面。": "Live preview failed. Reopen the audio adjustment page."
})

const PATTERNS: Array<[RegExp, string]> = [
  [/^轨道 (\d+)$/, 'Track $1'],
  [/^最多可添加 (\d+) 条混音片段$/, 'Up to $1 clips can be added to a mix'],
  [/^最多可添加 (\d+) 条混音轨道$/, 'Up to $1 tracks can be added to a mix'],
  [/^(\d+) 天$/, '$1 days'],
  [/^(.+)帧$/, '$1 fps'],
  [/^原生（(.+)）$/, 'Source ($1)'],
  [/^音高曲线 · (\d+) 个标记$/, 'Pitch curve · $1 markers'],
  [/^(-?[\d.]+|\+[\d.]+) 半音$/, '$1 semitones'],
  [/^选择标记 (\d+)$/, 'Select marker $1'],
  [/^定位标记 (\d+)$/, 'Go to marker $1'],
  [/^标记 (\d+)：([\d:.]+)$/, 'Marker $1: $2'],
  [/^标记 (\d+) · (.+)$/, 'Marker $1 · $2'],
  [/^删除标记 (\d+)$/, 'Delete marker $1'],
  [/^标记 (\d+)：([\d.]+) 秒，(-?[\d.]+) 半音$/, 'Marker $1: $2 s, $3 semitones'],
  [/^从素材栏移除 (.+)$/, 'Remove $1 from library'],
  [/^追加 (.+)$/, 'Append $1'],
  [/^(.+): 无法读取路径$/, '$1: Unable to read file path'],

  [/^已提取 (.+) 音频$/, 'Extracted $1 of audio'],
  [/^已保存：(.+)$/, 'Saved: $1'],
  [/^已从素材栏移除：(.+)$/, 'Removed from library: $1'],
  [/^正在导出 (\d+)%$/, 'Exporting $1%'],
  [/^(\d+) 个素材文件已失效，已从素材库跳过$/, '$1 media files are missing and were skipped'],
  [/^前进 (\d+) 秒$/, 'Forward $1 s'],
  [/^后退 (\d+) 秒$/, 'Back $1 s'],
  [/^该按键已被“(.+)”使用$/, 'Shortcut already used by “$1”'],
  [/^确定移除素材“(.+)”及其时间线片段吗？$/, 'Remove “$1” and its timeline clips?'],
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

  const description = /^(\d+ kbps|无损编码) · (.+) · (-?[\d.]+) dB · 渐入 ([\d.]+)s \/ 渐出 ([\d.]+)s$/.exec(core)
  if(description) return preserveWhitespace(input, translateUiText(description[1], language)+' · '+translateUiText(description[2], language)+' · '+description[3]+' dB · Fade in '+description[4]+'s / Fade out '+description[5]+'s')
  for(const [prefix,english] of [['无法启用实时试听：','Unable to enable live preview: '],['保存设置失败：','Unable to save settings: '],['保存素材库失败：','Unable to save media library: '],['保存提取记录失败：','Unable to save extracted records: ']]) {
    if(core.startsWith(prefix))return preserveWhitespace(input,english+translateUiText(core.slice(prefix.length),language))
  }
  const shortcutConflict = /^该按键已被“(.+)”使用$/.exec(core)
  if(shortcutConflict)return preserveWhitespace(input,'Shortcut already used by “'+translateUiText(shortcutConflict[1],language)+'”')
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
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: node => node instanceof Element && node.getAttribute('translate') === 'no'
      ? NodeFilter.FILTER_REJECT
      : NodeFilter.FILTER_ACCEPT,
  })
  let node = walker.nextNode()
  while (node) {
    translateNode(node, language)
    node = walker.nextNode()
  }
}
