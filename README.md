# HanziGo — 汉字学习好伙伴

给小学到初中的孩子做的生字学习 PWA，照着人教版（部编版）课本的识字表走，
一年级到九年级共 18 个学期、4014 个字，按课分组。

**在线使用**：https://learning-hub-ai.github.io/hanzi-go/

手机上打开后可以「添加到主屏幕」，之后离线也能用。

## 三种用法

| 模式 | 做什么 |
|---|---|
| 📚 学习 | 3D 翻卡 —— 正面是字，翻过来是拼音、组词、例句，点字会朗读，还能看笔顺、自己描写 |
| 🎯 挑战 | 字→音、音→字、字→词、填空、混合五种题型 —— 计分、连对加成、拿徽章 |
| 📅 每日任务 | 四步流程：认字 → 测验 → 错题 → 收尾，做完算一天 |

**小故事**（一、二年级，试读中）：学习模式里，学完一课可以读一篇用到这课生字的原创小故事，
每个字都能点、会朗读、会进生字本。故事不公开：网站上只有加密的文件，凭邀请码打开（见「小故事」）。

答错的字自动进**错题本**，连对两次才移出去（`config.json` 可调）。喜欢的字可以❤️收藏，单独复习。
**智能复习**按间隔重复安排该复习的字。

**自定义字卡**：家长可以加课本以外的字词。在「正面」输入字后，会自动从课本
数据里填好拼音、词语和例句（多音字先选读音），都可以改，按「加入」才保存；
加好的卡也能随时修改。

进度存在本机，可以导出成文件备份，再导入到别的设备。

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

**课本字卡先播录音**：在线朗读只拿到汉字，读音靠引擎猜，「掷」「爪」
都读错过。课本里的字卡改为播放卡片拼音对应的音节录音（如 zhì、zhuǎ），
读音由数据决定，约 98% 的卡片有录音。录音放在 `audio/syllables/`，用
`scripts/gen_syllable_audio.py` 生成；没有录音的音节（ü、轻声和少数几个）
和自定义字卡仍走上面的在线朗读。录音播过一次就会离线缓存。

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
│   ├── services.js    副作用（朗读、徽章、收藏、错题、统计、自定义字卡及其自动填写）
│   ├── ui.js          只改 DOM，不含逻辑
│   ├── controllers.js 事件，把 state↔data↔UI 接起来
│   ├── daily-task.js  每日任务四步流程
│   ├── story.js       小故事阅读（封面、人物介绍、点字朗读）
│   ├── story-unlock.js 打开加密的故事（WebCrypto）
│   ├── story-invite.js 邀请码：链接和「谁来学习？」里的入口
│   ├── constants.js   常量和共用小工具
│   └── mobile.js      移动端适配
├── data/              18 个学期文件 grade{N}-semester{M}.json，多音字表 heteronyms.json，
│                      加密的小故事 stories.enc.json
├── assets/characters/ 小故事角色的图标（SVG）
├── audio/syllables/   字卡的音节录音（公共领域，见「版权」）
├── scripts/           生成和清理数据的脚本，见「加数据」
└── docs/              数据生成规范
```

## 小故事

故事原文在**私有**仓库 `learning-hub-ai/hanzi-go-stories`，克隆在本仓库旁边
（`../hanzi-go-stories/`），或者用环境变量 `HANZIGO_STORIES` 指向它的 `stories/`。
本仓库只放加密后的 `data/stories.enc.json`：AES-256-GCM，每个邀请码各包一份内容密钥
（格式见 `scripts/story_crypto.py`）。浏览器凭邀请码在本机解开，码存在这台设备上，
不进用户的导出备份。

```bash
python3 scripts/check_stories.py              # 检查故事：用字、读音、写法轮换
python3 scripts/build_stories.py              # 打包加密（先检查，私有仓库要先提交）
python3 scripts/build_stories.py --add-invite 名字   # 新邀请码，打印要发的链接
python3 scripts/build_stories.py --list       # 查看（不显示码）；--revoke <id> 取消
python3 scripts/story_brief.py 1-2-12 --text  # 写一课故事前的提要
```

没有私有仓库的机器上，这些检查会说明后跳过；网站和浏览器测试不需要原文
（测试用 `test/fixtures/stories.enc.json`，里面是编的故事，测试码公开）。

pre-push 会拦住原文：被跟踪的明文故事文件、任何文件或要推送的提交（改动和说明）里
出现故事里连续 6 个字或《标题》，都不能推送（`scripts/check_no_story_text.py`）。

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

数据要守的规矩（`pre-push.sh` 会检查）：例句必须是课文原句、包含这个字、
引号成对，尽量不超过 20 字。改了拼音或词语之后重新生成多音字表。

| 脚本 | 做什么 |
|---|---|
| `scripts/gen_heteronyms.py` | 生成 `data/heteronyms.json`：多音字朗读时用哪个词定读音 |
| `scripts/gen_syllable_audio.py` | 生成 `audio/syllables/`：字卡的音节录音（下载、统一音量、压缩）；`--all-cards` / `--poly-only` 切换范围，`--check` 只检查 |
| `scripts/shorten_sentences.py` | 把超过 20 字的例句截到含该字的完整分句（不改写）；`--review-dir` 导出要人工处理的清单 |
| `scripts/fix_quotes.py` | 补齐被 PDF 断行截掉一半的引号 |
| `scripts/fix_polluted_sentences.py`、`tidy_sentences.py` | 去掉混进例句的生字表、练习题、标题和作者 |

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
bash pre-push.sh        # 静态检查 + 数据检查 + 例句截短脚本的单元测试，推送前自动跑
```

```bash
# 浏览器测试：533 项，用隐藏 iframe 加载真实 app
python3 -m http.server 8080     # 然后开 http://localhost:8080/test.html 点 Run

# 或者无头跑。开发用的包都在 requirements-dev.txt（固定版本）
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
# 重新生成音节录音还需要：.venv/bin/pip install imageio-ffmpeg==0.6.0
.venv/bin/python scripts/run_tests_headless.py
```

无头脚本自己起 http server、用 CDP 驱动 Chrome、全过返回 0。
`test.html?autorun=1` 可以免点按钮。

规矩：改了行为就改测试的预期值，不是放宽断言。新测试要先在改动前的代码上
跑一次，确认它会失败。

`pre-push.sh` 检查 service worker、可点元素、字号和颜色都用 token、样式表结构、
离线缓存清单，以及数据：例句可用、引号成对、多音字表与数据一致、词语兜底
句和超过 20 字的例句不超过预算。

改了 `js/`、`css/` 或 `data/` 之后要把 `sw.js` 第一行的 `CACHE_VERSION` 加一，
否则已安装的 PWA 拿不到新版本。

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

### 音节录音

`audio/syllables/` 的录音来自
[davinfifield/mp3-chinese-pinyin-sound](https://github.com/davinfifield/mp3-chinese-pinyin-sound)，
以 Unlicense 发布（公共领域）。本项目只做了统一音量、去掉首尾静音和压缩，
不主张对录音本身的权利。
