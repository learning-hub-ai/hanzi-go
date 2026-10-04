# HanziGo — 汉字学习好伙伴

给小学到初中的孩子做的生字学习 PWA，照着人教版（部编版）课本的识字表走，
一年级到九年级共 18 个学期、4014 个字，按课分组。

**在线使用**：https://learning-hub-ai.github.io/hanzi-go/

手机上打开后可以「添加到主屏幕」，之后离线也能用。

## 三种用法

| 模式 | 做什么 |
|---|---|
| 📚 学习 | 3D 翻卡 —— 正面是字，翻过来是拼音、组词、例句，点字会朗读 |
| 🎯 挑战 | 看汉字选拼音 —— 计分、连对加成、拿徽章 |
| 📅 每日任务 | 四步流程：认字 → 测验 → 错题 → 收尾，做完算一天 |

答错的字自动进**错题本**，连对两次才移出去。喜欢的字可以❤️收藏，单独复习。
徽章三个：初次挑战、百发百中、识字达人。

## 本地打开

纯静态，没有构建步骤。双击 `index.html` 就能用。

想用手机或平板在同一个局域网里看：

```bash
python3 -m http.server 8080
# 然后访问 http://<电脑的IP>:8080
```

`server.py` 是可选的 —— 它多带一个 TTS 代理，发音比浏览器自带的自然些：

```bash
python3 server.py        # http://localhost:8000
```

朗读有四层回退：本地 `/tts` 代理 → Google → 百度 → 浏览器自带的
Web Speech API。线上版本没有代理，用后三种；如果网络拦了前两个，
就要靠浏览器里装的中文语音。

## 结构

```
hanzi-go/
├── index.html         页面结构，不含逻辑
├── config.json        可调参数（题目数、时长、徽章、鼓励语）
├── manifest.json      PWA 清单
├── sw.js              service worker，离线缓存
├── css/style.css      设计系统（CSS 变量 + 组件 + 响应式）
├── js/
│   ├── state.js       状态，唯一源头
│   ├── data.js        加载、筛选、出题
│   ├── services.js    副作用（朗读、徽章、收藏、错题、统计）
│   ├── ui.js          只改 DOM，不含逻辑
│   ├── controllers.js 事件，把 state↔data↔UI 接起来
│   ├── daily-task.js  每日任务四步流程
│   ├── constants.js   常量
│   └── mobile.js      移动端适配
├── data/              18 个学期文件，grade{N}-semester{M}.json
├── scripts/           从课本 PDF 生成数据的脚本
└── docs/              数据生成规范、云同步方案（草案）
```

## 加数据

往 `data/` 放一个 `grade{N}-semester{M}.json`，自动发现，不用改代码：

```json
{
  "grade": 2,
  "semester": 1,
  "lessons": [
    {
      "id": "2-1-1",
      "title": "课文1《小蝌蚪找妈妈》",
      "chars": [
        {"char": "塘", "pinyin": "táng", "words": ["池塘","鱼塘"], "sentence": "池塘里有一群小蝌蚪。"}
      ]
    }
  ]
}
```

`scripts/gen_g2s1.py` 是从课本 PDF 生成这种 JSON 的例子。课本 PDF 有版权，
不在仓库里；脚本默认去 `~/smilings/learning-buddy/keben/` 找，可用
`KEBEN_DIR` 环境变量覆盖。

## 调参数

改 `config.json`，不用动代码：

- `questionsPerRound` 每轮题目数（默认 10）
- `quizFeedbackDelayMs` 答完停留多久再出下一题（默认 1200ms）
- `streakThresholdForFire` 连对几个出火焰动画（默认 3）
- `wrongAnswersToRemoveFromErrorBook` 连对几次移出错题本（默认 2）
- `speech.rate` 朗读速度（默认 0.8，比正常慢一点）
- `badges` 徽章定义
- `encourageMessages` 按得分给的鼓励语

## 技术

原生 HTML / CSS / JavaScript，无框架、无构建工具。CSS 自定义属性做主题，
localStorage 存进度，service worker 做离线。IIFE 模块模式以兼容旧浏览器。

浏览器要求：Chrome / Edge 88+、Safari 14+（iOS / macOS）、Firefox 85+、微信内置浏览器。

## 测试

两层：

```bash
bash pre-push.sh        # 15 项静态检查，推送前自动跑
```

```bash
# 浏览器测试：153 项，用隐藏 iframe 加载真实 app
python3 -m http.server 8080     # 然后开 http://localhost:8080/test.html 点 Run

# 或者无头跑（需要 websocket-client）
python3 -m venv .venv && .venv/bin/pip install websocket-client
.venv/bin/python scripts/run_tests_headless.py
```

无头脚本自己起 http server、用 CDP 驱动 Chrome、全过返回 0。
`test.html?autorun=1` 可以免点按钮。

规矩：改了行为就改测试的预期值，不是放宽断言。

`pre-push.sh` 在推送前跑 15 项检查（service worker 合法性、可点元素可达性等）。

## 版权

**版权归本项目作者所有，保留所有权利。** 详见 [LICENSE](LICENSE)。

公开本仓库是为了方便使用和交流，不等于放弃权利。

✅ **欢迎这样用，不必告知**：在线使用、克隆到本地自用、为自己使用做修改、
在课堂或读书会上使用、链接和分享网址、阅读代码学习。

🚫 **请不要**：把代码或内容复制到别处重新发布（请改为放链接）、收费出售或
作为付费产品的一部分、去掉出处后重新发布、用于任何商业用途。

需要超出上述范围的使用，请先联系作者。

### 教材数据

`data/` 里的生字、拼音、组词、例句、课文标题**全部来自人教版（部编版）语文教材** ——
例句是课文原句（见 `docs/data-generation-spec.md`：必须来自课文原文，不允许自行改写或造句），
组词也优先取自课文与词语表。

**这部分版权归教材编者及出版社（人民教育出版社）所有**，本项目只是按课整理成练习数据，
供学习使用，不主张对这部分内容的权利。

属于本项目的是：代码、界面文字、说明文档、数据的组织方式。

教材 PDF 不在本仓库内。
