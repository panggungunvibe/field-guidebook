// Content-only settings. Keep the layout and interaction modules unchanged when
// adapting this guide to a new subject. Values are plain text, never HTML.
export const SITE = {
  language: "zh-CN",
  title: "FRIM 植物漫游",
  homeTitle: "FRIM 植物漫游 — Forest Research Institute Malaysia Guide Book",
  description: "以 FRIM 现场照片为线索的马来西亚森林研究院植物漫游 Guide Book。",
  favicon: "/favicon.svg",
  themeStorageKey: "frim-guide-theme",
  brand: {
    logo: "/frim-logo.png", // Set to "" to show wordmark text instead.
    logoAlt: "Forest Research Institute Malaysia",
    homeLabel: "FRIM 植物漫游首页",
    returnLabel: "返回 FRIM 植物漫游首页",
    wordmark: "FRIM",
    url: "https://www.frim.gov.my/",
    label: "Forest Research Institute Malaysia",
    year: "2026",
    bookTitle: "FRIM Guide Book",
    bookMotto: "LOOK CLOSELY · LEAVE IT WHERE IT GROWS",
  },
  hero: {
    titleLines: ["植物", "漫游"],
    description: "一份以现场照片为线索的 FRIM 自主植物导览。",
  },
  search: {
    noun: "植物",
    formLabel: "搜索植物",
    homeFormLabel: "搜索现场植物",
    placeholder: "搜索植物、学名或特征",
    homePlaceholder: "植物",
    resultsLabel: "植物搜索结果",
    matchesLabel: "匹配的植物",
  },
  gallery: {
    label: "现场植物图鉴",
    collectionLabel: "最新图鉴",
    recommendedLabel: "推荐植物图鉴",
  },
  article: {
    overviewTitle: "先认识它",
    factLabels: ["学名／识别层级", "识别可信度", "现场先找"],
    photosTitle: "现场照片",
    photosCaption: "来自本次 FRIM 行走记录",
    photoCredit: "用户现场拍摄 · 识别结果不等同正式植物标本鉴定",
    sourcesTitle: "资料与识别边界",
    sourcesTocTitle: "资料与边界",
    factCheck: "现场照片识别不等同正式植物标本鉴定。中低可信条目保留到属、科或形态层级，不强行定种。",
    relatedTitle: "继续寻找",
    relatedLabel: "相关观察条目",
    photoFallback: "现场观察",
  },
};
