#!/usr/bin/env node

import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_NAME = '上证指数';
const DEFAULT_SESSION = '收盘';

const SESSION_LABELS = {
  close: '收盘',
  closing: '收盘',
  midday: '午盘',
  noon: '午盘',
  none: '',
  '': ''
};

const USAGE = `
用法:
  node scripts/generate-daily-review.mjs [--name 上证指数] [--date 2026-06-01] [--session 收盘]

说明:
  这个脚本只生成 2026-05-29 风格的复盘模板结构，不自动分析行情。

常用参数:
  --name       标的名称，默认 上证指数
  --date       文档日期，默认使用 Asia/Shanghai 当前日期
  --session    收盘 / 午盘 / close / midday / none，默认 收盘
  --suffix     自定义文件名后缀，默认为 标的 + 场次 + 缠论复盘
  --no-summary 只生成 Markdown，不生成摘要 HTML
  --force      覆盖已存在文件
`.trim();

function parseArgs(argv) {
  const options = { _: [], summary: true, force: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--force') {
      options.force = true;
      continue;
    }

    if (arg === '--no-summary') {
      options.summary = false;
      continue;
    }

    if (arg.startsWith('--')) {
      const [rawKey, rawValue] = arg.slice(2).split('=');
      const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const value = rawValue ?? argv[index + 1];
      if (rawValue === undefined) {
        index += 1;
      }
      options[key] = value;
      continue;
    }

    options._.push(arg);
  }

  return options;
}

function todayInShanghai() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date());
}

function normalizeSession(value) {
  const input = String(value ?? DEFAULT_SESSION).trim();
  return SESSION_LABELS[input] ?? input;
}

function sanitizeFilePart(value) {
  return String(value).replace(/[<>:"/\\|?*]/g, '-').trim();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entities[char];
  });
}

function priceLabel(sessionLabel) {
  return sessionLabel === '午盘' ? '午盘价' : '收盘价';
}

function tailBarsTitle(sessionLabel) {
  return sessionLabel === '午盘' ? '午盘5根K线（5分钟）' : '尾盘5根K线（5分钟）';
}

function futureLabel(sessionLabel) {
  return sessionLabel === '午盘' ? '下午' : '下个交易日';
}

function buildContext(options) {
  const name = options.name || options._[0] || DEFAULT_NAME;
  const date = options.date || todayInShanghai();
  const sessionLabel = normalizeSession(options.session);
  const suffix = options.suffix || `${name}${sessionLabel}缠论复盘`;
  const title = `${suffix} — ${date}`;
  const fileBase = `${date}-${sanitizeFilePart(suffix)}`;

  return {
    name,
    date,
    sessionLabel,
    suffix,
    title,
    fileBase,
    reviewFileName: `${fileBase}.md`,
    summaryFileName: `${fileBase}-summary.html`,
    priceLabel: priceLabel(sessionLabel),
    tailBarsTitle: tailBarsTitle(sessionLabel),
    futureLabel: futureLabel(sessionLabel)
  };
}

function buildReviewMarkdown(ctx) {
  return `# ${ctx.title}

> 数据来源：项目分钟缠论模块（\`chan-intraday.js\` + \`chan.js\`），新浪分钟 K 线，截至 ${ctx.date} ${ctx.sessionLabel || '复盘'}。本文仅基于 5 分钟、30 分钟缠论结构独立分析，不参考项目内既有复盘文档。

---

## 一、盘面数据

| 指标 | 数值 |
|------|------|
| ${ctx.priceLabel} | **[填写价格]** |
| 今日K线 | O=[填写] H=[填写] L=[填写] C=[填写] |
| 较前收 | [填写前收] → [填写最新价]（**[填写涨跌幅]**） |
| 振幅 | [填写点数] 点（约 [填写百分比]） |
| 30分钟关键压力 | [填写压力1]、[填写压力2]、[填写压力3] |
| 30分钟关键支撑 | **[填写支撑1]**、[填写支撑2]、[填写支撑3] |
| 5分钟关键压力 | [填写压力1]、[填写压力2]、[填写压力3] |
| 5分钟关键支撑 | [填写支撑1]、**[填写支撑2]**、[填写支撑3] |

### 分时回顾

- [填写分时走势 1]
- [填写分时走势 2]
- [填写分时走势 3]
- [填写分时走势 4]
- [填写分时走势 5]
- [填写分时走势 6]

### ${ctx.tailBarsTitle}

| 时间 | 开 | 高 | 低 | 收 |
|------|----:|----:|----:|----:|
| [时间] | [开] | [高] | [低] | [收] |
| [时间] | [开] | [高] | [低] | [收] |
| [时间] | [开] | [高] | **[低]** | [收] |
| [时间] | [开] | [高] | [低] | [收] |
| [时间] | [开] | [高] | [低] | **[收]** |

[填写尾盘/午盘反抽、回落、站位和结构修复评价。]

---

## 二、30分钟级别走势

| 指标 | 数值 |
|------|------|
| 当前笔方向 | [填写当前笔方向与区间] |
| 最新30分中枢 | **[填写中枢下沿] - [填写中枢上沿]** |
| 中枢状态 | [填写状态]（中枢 #[编号]，[笔数] 笔） |
| 最新线段 | [填写方向]线段 #[编号]：[起点] → [终点]（[幅度]） |
| 最新信号 | **[填写信号]**（[结构时间] 结构形成，[确认时间] 确认，[执行时间] 执行参考 [价格]） |
| 数据区间 | [填写起始时间] → [填写结束时间] |

### 最近3笔

| 笔 | 方向 | 区间 | 起点价 | 终点价 | 涨跌幅 | 单位力度 |
|----|------|------|------:|------:|------:|----------:|
| #[编号] | [方向] | [起点] → [终点] | [起点价] | [终点价] | [涨跌幅] | [力度] |
| #[编号] | [方向] | [起点] → **[终点]** | [起点价] | **[终点价]** | [涨跌幅] | [力度] |
| #[编号] | [方向] | [起点] → **[终点]** | [起点价] | **[终点价]** | [涨跌幅] | **[力度]** |

### 力度判断：[填写核心判断标题]

[填写 30 分钟力度背景说明。]

| 对比项 | 前一同向笔 | 最新同向笔 |
|--------|----------:|----------:|
| 区间 | [起点] → [终点] | [起点] → [终点] |
| 涨跌幅 | [填写] | **[填写]** |
| 单位力度 | [填写] | **[填写]** |
| 力度比 | - | **[填写]** |

[填写 30 分钟结论：是反弹弱、下跌衰竭、买点确认、卖点有效，还是仍需等待确认。]

### 中枢结构：[填写中枢重心判断]

| 中枢 | 范围 | 状态 | 结构意义 |
|------|------|------|----------|
| #[编号] | [下沿] - [上沿] | [状态] | [意义] |
| #[编号] | [下沿] - [上沿] | [状态] | [意义] |
| **#[编号]** | **[下沿] - [上沿]** | **[状态]** | [意义] |

[填写中枢重心变化、当前价格相对中枢的位置，以及该位置的结构含义。]

### 30分钟信号链

| 时间 | 信号 | 结构价 | 执行参考 | 说明 |
|------|------|-------:|---------:|------|
| [时间] | [信号] | [结构价] | [执行价] | [说明] |
| [时间] | [信号] | [结构价] | [执行价] | [说明] |
| **[时间]** | **[信号]** | **[结构价]** | **[执行价]** | [说明] |

---

## 三、5分钟级别走势

| 指标 | 数值 |
|------|------|
| 当前笔方向 | [填写当前笔方向与区间] |
| 最新5分中枢 | **[填写中枢下沿] - [填写中枢上沿]** |
| 中枢状态 | [填写状态]（中枢 #[编号]，[笔数] 笔） |
| 最新线段 | [填写方向]线段 #[编号]：[起点] → [终点]（[幅度]） |
| 结构状态 | [填写结构状态] |

### 今日核心5分钟笔

| 笔 | 方向 | 时间 | 区间 | 涨跌幅 | 单位力度 |
|----|------|------|------|--------:|----------:|
| #[编号] | [方向] | [时间] | [起点] → [终点] | [涨跌幅] | [力度] |
| #[编号] | [方向] | [时间] | [起点] → [终点] | [涨跌幅] | [力度] |
| #[编号] | [方向] | [时间] | [起点] → [终点] | [涨跌幅] | [力度] |
| #[编号] | [方向] | [时间] | [起点] → [终点] | [涨跌幅] | [力度] |
| **#[编号]** | [方向] | [时间] | [起点] → **[终点]** | **[涨跌幅]** | **[力度]** |

### 下跌/上涨力度判断：[填写5分钟力度结论标题]

| 对比项 | 前一同向笔 | 最新同向笔 |
|--------|----------:|----------:|
| 区间 | [起点] → [终点] | [起点] → [终点] |
| 涨跌幅 | [填写] | **[填写]** |
| 单位力度 | [填写] | **[填写]** |
| 幅度比 | - | **[填写]** |
| 能量比 | - | **[填写]** |

[填写 5 分钟力度结论：是否背驰、是否增强、是否只是弱反抽。]

### 5分钟中枢

| 中枢 | 范围 | 状态 | 结构意义 |
|------|------|------|----------|
| #[编号] | [下沿] - [上沿] | [状态] | [意义] |
| **#[编号]** | **[下沿] - [上沿]** | **[状态]** | [意义] |

[填写当前价格相对 5 分钟中枢的位置，以及短线强弱含义。]

### 今日5分钟信号序列

| 时间 | 信号 | 结构价 | 执行参考 | 说明 |
|------|------|-------:|---------:|------|
| [时间] | [信号] | [结构价] | [执行价] | [说明] |
| [时间] | [信号] | [结构价] | [执行价] | [说明] |
| [时间] | [信号] | [结构价] | [执行价] | [说明] |
| [时间] | [信号] | [结构价] | [执行价] | [说明] |
| [时间] | [信号/低点/高点] | [结构价] | - | [说明] |

---

## 四、信号链复盘

[填写今日信号链总评。]

\`\`\`text
[填写起点事件]
  → [填写信号/动作 1]
  → [填写信号/动作 2]
  → [填写信号/动作 3]
  → [填写信号/动作 4]
  → [填写收盘状态]
\`\`\`

[填写这条信号链的核心含义，例如：支撑后的反击太弱、买点后没有脱离中枢、卖点后空头是否继续占优。]

### 与上个交易日预判对照

> 对照来源：上个交易日复盘「关键价位表」及操作铁律中的价位预判。

| 上个交易日关键价位 | 预判 | 今日实际 |
|--------------------|------|----------|
| **[价位/区域]** | [预判] | [实际] |
| **[价位/区域]** | [预判] | [实际] |
| **[价位/区域]** | [预判] | [实际] |
| **[价位/区域]** | [预判] | [实际] |
| **[价位/区域]** | [预判] | [实际] |
| **[价位/区域]** | [预判] | [实际] |

---

## 五、多级别联立分析

\`\`\`text
30分钟：[填写 30 分钟结构结论]
         [填写补充判断]
         ↓
5分钟：  [填写 5 分钟结构结论]
         [填写补充判断]
         ↓
综合：   [填写综合判断]
\`\`\`

### 多级别共振判断

| 维度 | 30分钟 | 5分钟 | 共振方向 |
|------|--------|-------|----------|
| 趋势 | [填写] | [填写] | **[填写]** |
| 中枢 | [填写] | [填写] | **[填写]** |
| 背驰 | [填写] | [填写] | **[填写]** |
| 修复条件 | [填写] | [填写] | [填写] |

---

## 六、关键价位表

| 价位 / 区域 | 意义 | 操作含义 |
|-------------|------|----------|
| **[价位]** | [意义] | [操作含义] |
| **[价位]** | [意义] | [操作含义] |
| **[价位]** | [意义] | [操作含义] |
| **[价位]** | [意义] | [操作含义] |
| **[价位]** | [意义] | [操作含义] |
| **[价位]** | [意义] | [操作含义] |
| **[价位]** | [意义] | [操作含义] |
| **[价位]** | [意义] | [操作含义] |

---

## 七、${ctx.futureLabel}情景推演

### 情景一（概率 [填写]%）：[填写情景标题]

[填写情景说明。]

### 情景二（概率 [填写]%）：[填写情景标题]

[填写情景说明。]

### 情景三（概率 [填写]%）：[填写情景标题]

[填写情景说明。]

### 情景四（概率 [填写]%）：[填写情景标题]

[填写情景说明。]

---

## 八、持仓与空仓策略

### 持仓者

\`\`\`text
[填写持仓前提]：
  → [填写操作 1]
  → [填写操作 2]
  → [填写操作 3]
  → [填写操作 4]
  → [填写纪律]
\`\`\`

### 空仓者

\`\`\`text
[填写空仓总原则。]

可观察两类机会：
  ① [填写机会 1]
  ② [填写机会 2]

不能做的事：
  ① [填写禁止动作 1]
  ② [填写禁止动作 2]
  ③ [填写禁止动作 3]
\`\`\`

---

## 九、铁律提醒

1. **[填写铁律 1]**：[填写说明]
2. **[填写铁律 2]**：[填写说明]
3. **[填写铁律 3]**：[填写说明]
4. **[填写铁律 4]**：[填写说明]
5. **[填写铁律 5]**：[填写说明]
6. **[填写铁律 6]**：[填写说明]

> **一句话总结：[填写一句话总结。]**
`;
}

function buildSummaryHtml(ctx) {
  const title = escapeHtml(ctx.title);
  const reviewFileName = escapeHtml(ctx.reviewFileName);
  const future = escapeHtml(ctx.futureLabel);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(ctx.date)} ${escapeHtml(ctx.suffix)} · 分模块摘要</title>
  <link rel="stylesheet" href="summary.css">
</head>
<body>
  <main class="page">
    <a class="back-link" href="index.html">← 返回摘要列表</a>

    <header class="hero">
      <div class="badge">Summary</div>
      <h1>${title}</h1>
      <p class="meta">分模块摘要 · 原文：<code>${reviewFileName}</code></p>
      <p class="one-liner"><strong>一句话：</strong>[填写一句话总结。]</p>
    </header>

    <section class="module">
      <div class="module-head"><span class="module-num">1</span><h2>盘面数据</h2></div>
      <div class="module-body">
        <table class="data-table">
          <tr><th>指标</th><th>数值</th></tr>
          <tr><td>${escapeHtml(ctx.priceLabel)}</td><td><strong>[填写价格]</strong>（[填写涨跌幅]）</td></tr>
          <tr><td>今日K线</td><td>O=[填写] H=[填写] L=[填写] C=[填写]</td></tr>
          <tr><td>振幅</td><td>[填写点数] 点（约 [填写百分比]）</td></tr>
          <tr><td>30分钟压力</td><td>[填写压力位]</td></tr>
          <tr><td>30分钟支撑</td><td><strong>[填写支撑位]</strong></td></tr>
          <tr><td>5分钟压力</td><td>[填写压力位]</td></tr>
          <tr><td>5分钟支撑</td><td>[填写支撑位]</td></tr>
        </table>
        <div class="subhead">分时回顾</div>
        <ul>
          <li>[填写分时要点 1]</li>
          <li>[填写分时要点 2]</li>
          <li>[填写分时要点 3]</li>
          <li>[填写分时要点 4]</li>
          <li>[填写分时要点 5]</li>
        </ul>
        <div class="subhead">${escapeHtml(ctx.tailBarsTitle)}</div>
        <table class="data-table">
          <tr><th>时间</th><th>开</th><th>高</th><th>低</th><th>收</th></tr>
          <tr><td>[时间]</td><td>[开]</td><td>[高]</td><td>[低]</td><td>[收]</td></tr>
          <tr><td>[时间]</td><td>[开]</td><td>[高]</td><td>[低]</td><td>[收]</td></tr>
          <tr><td>[时间]</td><td>[开]</td><td>[高]</td><td><strong>[低]</strong></td><td>[收]</td></tr>
          <tr><td>[时间]</td><td>[开]</td><td>[高]</td><td>[低]</td><td><strong>[收]</strong></td></tr>
        </table>
      </div>
    </section>

    <section class="module">
      <div class="module-head"><span class="module-num">2</span><h2>30 分钟走势</h2></div>
      <div class="module-body">
        <table class="data-table">
          <tr><th>指标</th><th>状态</th></tr>
          <tr><td>当前笔</td><td>[填写当前笔方向与区间]</td></tr>
          <tr><td>最新中枢</td><td><strong>[填写中枢范围]</strong>，[填写状态]</td></tr>
          <tr><td>最新线段</td><td>[填写线段信息]</td></tr>
          <tr><td>最新信号</td><td><strong>[填写信号]</strong>，[填写执行信息]</td></tr>
        </table>
        <div class="subhead">力度判断</div>
        <table class="data-table">
          <tr><th>对比项</th><th>前一同向笔</th><th>最新同向笔</th></tr>
          <tr><td>区间</td><td>[填写]</td><td>[填写]</td></tr>
          <tr><td>单位力度</td><td>[填写]</td><td><strong>[填写]</strong></td></tr>
          <tr><td>力度比</td><td>-</td><td><strong>[填写]</strong></td></tr>
        </table>
        <div class="callout warn"><strong>结论：</strong>[填写 30 分钟结论。]</div>
        <div class="subhead">30分钟信号链</div>
        <table class="data-table">
          <tr><th>时间</th><th>信号</th><th>结构价</th><th>说明</th></tr>
          <tr><td>[时间]</td><td>[信号]</td><td>[结构价]</td><td>[说明]</td></tr>
          <tr><td>[时间]</td><td><strong>[信号]</strong></td><td>[结构价]</td><td>[说明]</td></tr>
        </table>
      </div>
    </section>

    <section class="module">
      <div class="module-head"><span class="module-num">3</span><h2>5 分钟走势</h2></div>
      <div class="module-body">
        <table class="data-table">
          <tr><th>指标</th><th>状态</th></tr>
          <tr><td>当前笔</td><td>[填写当前笔方向与区间]</td></tr>
          <tr><td>最新中枢</td><td><strong>[填写中枢范围]</strong>，[填写状态]</td></tr>
          <tr><td>最新线段</td><td>[填写线段信息]</td></tr>
          <tr><td>结构状态</td><td>[填写结构状态]</td></tr>
        </table>
        <div class="subhead">力度判断</div>
        <table class="data-table">
          <tr><th>对比项</th><th>前一同向笔</th><th>最新同向笔</th></tr>
          <tr><td>区间</td><td>[填写]</td><td>[填写]</td></tr>
          <tr><td>涨跌幅</td><td>[填写]</td><td><strong>[填写]</strong></td></tr>
          <tr><td>单位力度</td><td>[填写]</td><td><strong>[填写]</strong></td></tr>
          <tr><td>能量比</td><td>-</td><td><strong>[填写]</strong></td></tr>
        </table>
        <div class="callout warn"><strong>结论：</strong>[填写 5 分钟结论。]</div>
        <div class="subhead">今日5分钟信号</div>
        <table class="data-table">
          <tr><th>时间</th><th>信号</th><th>结构价</th><th>说明</th></tr>
          <tr><td>[时间]</td><td>[信号]</td><td>[结构价]</td><td>[说明]</td></tr>
          <tr><td>[时间]</td><td>[信号]</td><td>[结构价]</td><td>[说明]</td></tr>
          <tr><td>[时间]</td><td><strong>[信号]</strong></td><td>[结构价]</td><td>[说明]</td></tr>
        </table>
      </div>
    </section>

    <section class="module">
      <div class="module-head"><span class="module-num">4</span><h2>信号链与联立</h2></div>
      <div class="module-body">
        <div class="flow">[填写信号链：事件 → 信号 → 结构变化 → 收盘状态]</div>
        <div class="flow">30分钟：[填写 30 分钟结构]
         ↓
5分钟：  [填写 5 分钟结构]
         ↓
综合：   [填写综合判断]</div>
        <table class="data-table">
          <tr><th>维度</th><th>30分钟</th><th>5分钟</th><th>共振</th></tr>
          <tr><td>趋势</td><td>[填写]</td><td>[填写]</td><td>[填写]</td></tr>
          <tr><td>背驰</td><td>[填写]</td><td>[填写]</td><td>[填写]</td></tr>
          <tr><td>修复条件</td><td>[填写]</td><td>[填写]</td><td>[填写]</td></tr>
        </table>
        <div class="subhead">与上个交易日关键价位对照</div>
        <table class="data-table">
          <tr><th>关键价位</th><th>预判</th><th>今日实际</th></tr>
          <tr><td>[价位]</td><td>[预判]</td><td>[实际]</td></tr>
          <tr><td>[价位]</td><td>[预判]</td><td>[实际]</td></tr>
          <tr><td>[价位]</td><td>[预判]</td><td>[实际]</td></tr>
        </table>
      </div>
    </section>

    <section class="module">
      <div class="module-head"><span class="module-num">5</span><h2>关键价位</h2></div>
      <div class="module-body">
        <table class="data-table">
          <tr><th>价位</th><th>意义</th><th>操作含义</th></tr>
          <tr><td>[价位]</td><td>[意义]</td><td>[操作含义]</td></tr>
          <tr><td>[价位]</td><td>[意义]</td><td>[操作含义]</td></tr>
          <tr><td>[价位]</td><td>[意义]</td><td>[操作含义]</td></tr>
          <tr><td>[价位]</td><td>[意义]</td><td>[操作含义]</td></tr>
        </table>
      </div>
    </section>

    <section class="module">
      <div class="module-head"><span class="module-num">6</span><h2>${future}情景概率</h2></div>
      <div class="module-body">
        <div class="scenario">
          <h4>情景一（概率 [填写]%）：[填写情景标题]</h4>
          <p>[填写情景说明。]</p>
        </div>
        <div class="scenario">
          <h4>情景二（概率 [填写]%）：[填写情景标题]</h4>
          <p>[填写情景说明。]</p>
        </div>
        <div class="scenario">
          <h4>情景三（概率 [填写]%）：[填写情景标题]</h4>
          <p>[填写情景说明。]</p>
        </div>
        <div class="scenario">
          <h4>情景四（概率 [填写]%）：[填写情景标题]</h4>
          <p>[填写情景说明。]</p>
        </div>
      </div>
    </section>

    <section class="module">
      <div class="module-head"><span class="module-num">7</span><h2>持仓与空仓策略</h2></div>
      <div class="module-body">
        <div class="subhead">持仓者</div>
        <ul>
          <li>[填写持仓策略 1]</li>
          <li>[填写持仓策略 2]</li>
          <li>[填写持仓策略 3]</li>
        </ul>
        <div class="subhead">空仓者</div>
        <ul>
          <li>[填写空仓策略 1]</li>
          <li>[填写空仓策略 2]</li>
          <li>[填写空仓策略 3]</li>
        </ul>
      </div>
    </section>

    <section class="module">
      <div class="module-head"><span class="module-num">8</span><h2>铁律提醒</h2></div>
      <div class="module-body">
        <ol class="rules">
          <li><strong>[填写铁律 1]</strong>：[填写说明]</li>
          <li><strong>[填写铁律 2]</strong>：[填写说明]</li>
          <li><strong>[填写铁律 3]</strong>：[填写说明]</li>
          <li><strong>[填写铁律 4]</strong>：[填写说明]</li>
          <li><strong>[填写铁律 5]</strong>：[填写说明]</li>
          <li><strong>[填写铁律 6]</strong>：[填写说明]</li>
        </ol>
      </div>
    </section>
  </main>
</body>
</html>
`;
}

async function writeFileSafely(filePath, content, force) {
  try {
    await access(filePath);
    if (!force) {
      return { filePath, skipped: true };
    }
  } catch {
    // File does not exist yet.
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  return { filePath, skipped: false };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(USAGE);
    return;
  }

  const ctx = buildContext(options);
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDir, '..');
  const reviewPath = path.join(rootDir, 'daily-reviews', ctx.reviewFileName);
  const summaryPath = path.join(rootDir, 'public', 'daily-review-summaries', ctx.summaryFileName);

  const written = [
    await writeFileSafely(reviewPath, buildReviewMarkdown(ctx), options.force)
  ];

  if (options.summary) {
    written.push(await writeFileSafely(summaryPath, buildSummaryHtml(ctx), options.force));
  }

  written.forEach((result) => {
    const status = result.skipped ? '已存在，跳过' : '已生成';
    console.log(`${status}: ${path.relative(rootDir, result.filePath)}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
