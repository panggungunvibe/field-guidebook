# 内容映射

`plant-*` 是兼容模板的文件名，不代表只能讲植物。所有文本字段是纯文本，不写 HTML。

## 替换入口

| 文件 | 内容 |
| --- | --- |
| `site-config.js` | 品牌、首页、搜索词、事实标签、页脚和说明 |
| `plant-data.js` | 册页列表、正文、封面、图集、来源与相关推荐 |
| `plant-observations.js` | 每册独特的观察题、提示与配图索引 |
| `public/media/` | 新主题的图片和 Logo；可自行创建这个目录 |

工作项目中的 `content-map.md` 可记录原文件名、复制后路径、对象、图注依据和来源。它是编辑记录，不必出现在读者界面。

## 站点配置

模板导出 `SITE`，保留其字段结构，按主题修改值：

| 字段组 | 修改项 |
| --- | --- |
| 顶层 | `language`、`title`、`homeTitle`、`description`、`favicon`、`themeStorageKey` |
| `brand` | `logo`、`logoAlt`、`homeLabel`、`returnLabel`、`wordmark`、`url`、`label`、`year`、`bookTitle`、`bookMotto` |
| `hero` | `titleLines`（通常两行短标题）、`description` |
| `search` | `noun`、`formLabel`、`homeFormLabel`、`placeholder`、`homePlaceholder`、`resultsLabel`、`matchesLabel` |
| `gallery` | `label`、`collectionLabel`、`recommendedLabel` |
| `article` | `overviewTitle`、`factLabels`、`photosTitle`、`photosCaption`、`photoCredit`、`sourcesTitle`、`sourcesTocTitle`、`factCheck`、`relatedTitle`、`relatedLabel`、`photoFallback` |

例如矿物主题可用首页 `['岩石', '漫游']`、搜索名词“矿物”、事实标签 `['名称／类别', '资料范围', '先看哪里']`。三个事实标签依次对应 `scientific`、`confidence`、`lookFor`，不改变字段次序。`brand.logo` 留空时显示 `wordmark`；无需借用 FRIM 的 Logo。无外部主页时 `brand.url` 可用 `/`。

`vite.config.js` 将配置同步到初始 HTML 的标题、描述、语言及 favicon，Canvas 书封与 DOM 书封也共用配置；不需要改渲染器里的品牌字样。更换 `site-config.js` 后重新构建生产版本。

## 一册的数据

| 字段 | 编排方法 |
| --- | --- |
| `slug` | 唯一的小写字母、数字、连字符；同时用作路由和观察记录的键 |
| `number` | 书封顺序编号字符串，例如 `01` |
| `title`, `english` | 标题、外文名或别名；没有外文名时 `english` 可为空 |
| `scientific` | 副标题／标识；非植物可填类别、型号或简短身份 |
| `kicker`, `categories` | 一句短线索及分类词数组，也参与搜索 |
| `color` | 六位十六进制纸张背景色，例如 `#d6bd74` |
| `image` | 封面主图的本地根路径，例如 `/media/quartz.jpg` |
| `confidence` | 识别或资料的范围；非植物同步更换页面标签 |
| `locate`, `lookFor` | 如何找到／辨认对象、具体观察线索 |
| `overview` | 短介绍：这是什么，为什么值得看 |
| `sectionTitles`, `sections` | 对齐的标题和正文数组，至少一章，数量由素材决定 |
| `quote`, `quoteNote` | 一句记忆点与性质；自写总结标为观察提示，不冒充引语 |
| `plates` | 图集：`image`、`caption`、`credit`、`ratio`、`position` |
| `sources` | 实际参考资料：`title`、`meta`、`url`；没有时可为空数组 |
| `related` | 其他已存在条目的 slug；单条内容时用空数组 |

保留文件末尾的绑定，让观察题随对应册页进入页面：

```js
import { PLANT_OBSERVATIONS } from './plant-observations.js';
export const PLANTS = [ /* 用户的新内容 */ ].map(book => ({
  ...book,
  observation: PLANT_OBSERVATIONS[book.slug],
}));
```

图集至少保留一张主图；确实缺图时创建明确写着“待补充图片”的本地占位图。不要把示例植物图当成新主题的真图。`ratio` 控制显示比例，`position` 控制图集裁切焦点；以实际图像为准。

搜索匹配标题、`english`、`scientific`、`kicker`、`categories`、`lookFor`。关键特征词应出现在这些文本中，不能仅画在照片上。

## 观察段

`PLANT_OBSERVATIONS` 的键与册页 slug 一致。例子是结构说明，不是让每册复用的文案：

```js
export const PLANT_OBSERVATIONS = {
  'quartz': {
    title: '在光线里读一块晶体',
    intro: '先找轮廓，再比较不同方向的反光。',
    items: [{
      title: '换个角度，亮面在哪里',
      text: '对照两个观察角度，找出亮斑的位置变化；先描述你看见的部分。',
      cue: { label: '比亮面', text: '留意亮斑所在的位置，以及它与边缘的关系。' },
      photoIndices: [0],
    }],
  },
};
```

每册至少一个观察项；通常 3–4 个足够，但不设内容配额。每项 `photoIndices` 可为 `[]`，最多两项，使用当前册页 `plates` 的零起始索引。同一照片在整个观察段最多出现一次。多个观察点共用一张原图时，把图放在最相关的一项，其他项用文字引导即可。

## 来源与更新

`sources` 是条目级参考，不自动等于某句话的证据。网页链接使用 HTTP(S)，用户的本地说明可整理为 `public/` 下的说明文件并以根路径引用。不要把未公开云文档的访问令牌、临时下载地址、账号信息或设备绝对路径写进发布素材。

可选的逐句 `provenance` 结构见 `provenance-model.js` 顶部注释；只有真实摘录与准确映射才添加。图注及信心措辞是内容的一部分，不为了清空提示而删掉证据边界。

替换主题后运行校验。检查不再引用的旧示例条目、旧 Logo、旧来源；确认无引用后再从生成项目移除无用示例媒体。保留完整模板在 Skill 目录中，供下一个新项目使用。
