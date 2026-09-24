# 配音接入指南(给配音方)

一句话:**我们给你一份「台词稿」,你交回「音频 + 时间表」,放进 `public/voice/<影片>/` 就能播。**
时长由你定 —— 画面会自动踩着你给的时间走(哪句开口、说到哪个词时动画该到哪一步),
字幕跟着声音显示,导出的视频自带配音。不需要我们改一行代码。

## 1. 流程

| 步骤 | 谁 | 做什么 |
| --- | --- | --- |
| 1 | 我们 | 导出台词稿:`npm run voice:script -- <影片> --out script.json` |
| 2 | 你 | 按台词稿生成音频(TTS 或录音),量出每句的时长和句中标记的时刻 |
| 3 | 你 | 写时间表 `timing.json`:可以用我们的参考排期 `npm run voice:layout -- script.json measured.json --out timing.json`,也可以按第 4 节的规则自己排 |
| 4 | 你 / 我们 | 校验:`npm run voice:check -- <影片> timing.json`,**没有错误**才算能交付 |
| 5 | 我们 | 把 `timing.json` 和音频放进 `public/voice/<影片>/`,打开页面点右上角「开启声音」 |

`<影片>` 是影片目录(`src/film/catalog.ts`)里的名字,也是 `public/voice/<影片>/` 的目录名:`film`、`derivatives`、`topology`、`voice-demo`(页面地址 `?scene=` 一般同名,只有演示片是 `?scene=voicedemo`)。
完整的参考实现见第 6 节(`npm run voice:demo`,用 macOS 自带的语音合成把整条流程跑一遍)。

## 2. 台词稿(我们给你)

每段一项。`kind` 决定时间怎么排:

- **`timed`**:按台词对齐的分段 —— **时长由你定**。台词稿里给出动画的需要:脚本按 `cues` 的顺序踩提示点
  (某句开口、句中某个词,或某句说完),`needs` 是从上一个提示点到这里动画至少要的秒数;`tail` 是最后一个提示点之后动画还要的秒数。
- **`fixed`**:动画时长固定的分段(老的片子都是这种)—— `duration` 不能变,每句要放进自己的字幕窗口(`draft`)。

```json
{
  "version": 1,
  "film": "voice-demo",
  "segments": [
    {
      "id": "tangent-slope",
      "name": "切线的斜率",
      "kind": "timed",
      "duration": 12.306,
      "lines": [
        {
          "id": "slope-1",
          "text": "切线有多陡,用它的<mark name=\"k\"/>斜率来衡量。",
          "plain": "切线有多陡,用它的斜率来衡量。",
          "marks": ["k"],
          "draft": { "start": 0.3, "end": 3.639, "marks": { "k": 2.228 } },
          "markNeeds": { "k": 0 },
          "needsEnd": 0.806
        },
        {
          "id": "slope-2",
          "text": "斜率等于纵向的变化,除以<mark name=\"dx\"/>横向的变化。",
          "plain": "斜率等于纵向的变化,除以横向的变化。",
          "marks": ["dx"],
          "draft": { "start": 3.889, "end": 7.894, "marks": { "dx": 6.483 } },
          "needsBefore": 0.028,
          "markNeeds": { "dx": 0.778 }
        },
        {
          "id": "slope-3",
          "text": "在 x 等于 1 这一点,斜率正好是 2。",
          "plain": "在 x 等于 1 这一点,斜率正好是 2。",
          "marks": [],
          "draft": { "start": 8.144, "end": 11.706 },
          "needsBefore": 1.017,
          "needsEnd": 1.389
        }
      ],
      "cues": [
        { "line": "slope-1", "mark": "k", "needs": 0 },
        { "line": "slope-1", "end": true, "needs": 0.806 },
        { "line": "slope-2", "needs": 0.028 },
        { "line": "slope-2", "mark": "dx", "needs": 0.778 },
        { "line": "slope-3", "needs": 1.017 },
        { "line": "slope-3", "end": true, "needs": 1.389 }
      ],
      "tail": 0
    }
  ]
}
```

| 字段 | 含义 |
| --- | --- |
| `lines[].text` | 台词,`<mark name="k"/>` 标出要对齐的词(不要念出来) |
| `lines[].plain` | 去掉标签的纯文本 —— **照着念这个** |
| `lines[].draft` | 我们按字数估的草稿时间(timed 段仅供参考;fixed 段就是字幕窗口) |
| `lines[].needsBefore` / `markNeeds` / `needsEnd` | 同 `cues` 里对应那一项的 `needs`(开口 / 标记 / 句尾),方便按句查看 |
| `cues` | 提示点顺序与动画需要(排时间的约束,见第 4 节)。没有 `mark` 的是「这句开口」,带 `mark` 的是「说到这个词」,带 `"end": true` 的是「这句说完」(句尾提示点) |
| `tail` | 最后一个提示点之后动画还要多久 |

上例读作:说到「斜率」之后动画至少要 0.806 秒,第一句才该说完;第二句开口几乎不用等(0.028 秒);
第二句开口后至少 0.778 秒才能说到「横向」;再过至少 1.017 秒第三句开口,开口后至少 1.389 秒才该说完;
第三句说完动画也就播完了(`tail` 为 0)。

## 3. 时间表(你交回来)

时间一律是**秒,相对本段开头**(不是全片)。JSON Schema 见 [voice-timing.schema.json](voice-timing.schema.json)。
音频有三种组织方式,可以混用:

**每句一个文件**(最常见):

```json
{
  "version": 1,
  "film": "voice-demo",
  "locale": "zh-CN",
  "segments": [
    {
      "id": "tangent-slope",
      "duration": 13.1,
      "lines": [
        { "id": "slope-1", "text": "切线有多陡,用它的<mark name=\"k\"/>斜率来衡量。",
          "start": 0.3, "end": 3.9, "audio": "slope-1.m4a", "marks": { "k": 2.4 } },
        { "id": "slope-2", "text": "斜率等于纵向的变化,除以<mark name=\"dx\"/>横向的变化。",
          "start": 4.2, "end": 8.5, "audio": "slope-2.m4a", "marks": { "dx": 6.9 } },
        { "id": "slope-3", "text": "在 x 等于 1 这一点,斜率正好是 2。",
          "start": 8.8, "end": 12.4, "audio": "slope-3.m4a" }
      ]
    }
  ]
}
```

**整段一个文件**:音频写在分段上,从本段开头播;`lines` 只管字幕与提示点。

```json
{ "id": "tangent-slope", "duration": 13.1, "audio": "tangent-slope.mp3",
  "lines": [ { "id": "slope-1", "start": 0.3, "end": 3.9, "marks": { "k": 2.4 } }, "…" ] }
```

**一个长文件管好几段**:用 `offset` 指出这一段从文件的第几秒开始。

```json
{ "id": "tangent-slope", "duration": 13.1, "audio": { "file": "chapter-1.m4a", "offset": 42.6 },
  "lines": [ "…" ] }
```

## 4. 规则

- **id 对上**:分段 `id`、台词 `id` 抄台词稿的。fixed 段的台词 id 形如 `片头/1`(分段 id / 序号)。
- **句子**:每段内按开口时刻排序、互不重叠,`0 ≤ start < end ≤ duration`。
  声音从 `start` 开始播、放完为止(最多到本段结束);`end` 只决定字幕什么时候消失。
- **标记**:台词里每个 `<mark name="…"/>` 都要在 `marks` 里给出那个词的时刻(相对本段开头,落在这句的起止之内);
  不给会按字数比例估,校验时会提醒。TTS 一般都能给出(SSML 的 `<mark>` / bookmark),录音可以在剪辑软件里打点。
- **timed 段的时长由你定,但要满足动画**:
  - 按 `cues` 的顺序,每个提示点的时刻 ≥ 上一个提示点的时刻 + 它的 `needs`
    (提示点的时刻:「某句开口」就是那句的 `start`;「句中某个词」就是那个标记的时刻;
    「某句说完」(`"end": true`)就是那句的 `end`);
  - 句尾提示点是软约束:那句说得比动画短也能用(动画比这句多播一会儿,校验只提醒);
    后面的提示点从 max(这个时刻, 上一个提示点 + `needs`) 算起 —— 其他提示点也一样,都从「实际时刻与要求时刻中较晚的」接着算;
  - 一句的第一个提示点就是句尾时(台词稿里没有它的开口提示点),让它在「上一个提示点 + `needs`」时正好说完或更晚;
    我们的工具导出的台词稿总会先给出开口提示点;
  - `duration` ≥ 最后一个提示点的时刻 + `tail`,也 ≥ 最后一句说完;
  - 建议:段首留 ≥ 0.3 秒,句间停 ≥ 0.25 秒,段尾留 ≥ 0.6 秒(参考排期就是这么排的)。
- **fixed 段**:`duration` 等于台词稿给的;每句从自己字幕窗口的开头说起,不能说到下一句的窗口里(说不完请加快语速)。
- **音频**:mp3、m4a(AAC)、wav、ogg(Opus)都行;单声道或立体声,44.1kHz / 48kHz。
  文件路径相对 `timing.json`,也可以写完整网址 —— **放在别的域名下时要开 CORS**(`Access-Control-Allow-Origin`),
  否则浏览器读不到音频,导出时也混不进去。
- **位置**:`public/voice/<影片>/timing.json`(音频放同一个目录最省事)。没有这个文件就是没有配音,片子照常无声播放。

## 5. 校验

```bash
npm run voice:check -- voice-demo public/voice/voice-demo/timing.json
```

按时间表把每个 timed 段干跑一遍(不画画面,几秒钟),有错误时退出码为 1。常见报错:

| 报错 | 怎么改 |
| --- | --- |
| 动画来不及:第 N 个提示点……晚了 x 秒 | 把那句(或那个词)往后挪 x 秒,通常是在前一句后面多停一会儿 |
| 动画收不住:第 N 个提示点……晚了 x 秒 | 同上:那句开口(或那个词)排得比动画要的早,往后挪 x 秒 |
| 动画时间不够:第 N 个提示点(台词「…」说完)……(提醒) | 这句说得比动画短,能用;想对齐就让这句说慢一点 |
| 动画比时间表长 x 秒 | 本段 `duration` 加 x 秒(段尾多留点静音) |
| 标记「…」在这句里说得太早 | 在那个词前面加停顿,或把这句拆成两段音频 |
| 台词改过了:时间表按「…」做,现在是「…」 | 稿子改了,这句要重做 |
| 分段「…」在时间表里没有 / 在影片里找不到 | id 没对上(检查拼写) |
| 台词「…」说了 x 秒……会撞上下一句 | fixed 段放不下:加快语速或精简 |
| 音频文件「…」不存在 | 路径相对 `timing.json`,检查文件名 |

声音听不到时:浏览器规定要用户点一下才允许出声 —— 点页面右上角「开启声音」;再检查文件路径与 CORS。
另外,时间表只在页面加载时读一次:生成或替换了配音之后要**刷新页面**。

导出的成片没有配音时:导出完成后工具条下方会提示原因(程序里看 `exportVideo()` 返回句柄的 `audio`):

| 提示 | 意思 |
| --- | --- |
| 成片含配音,但 N 个配音文件取不到或解不开 | 那几句是静音;提示里列出了文件名,检查路径、格式与 CORS |
| 成片没有配音:当前浏览器解码不了音频 / 浏览器编不了 … 的音频 | 这个浏览器的离线导出带不上声音,而实时录制也录不了(比如选了只有离线编得出的格式);换「自动」格式或换浏览器 |
| 成片没有配音:浏览器没有允许出声 / 接不上录制用的音轨 | 实时录制时声音没接进来;重新点一次「导出」(点击本身就是出声许可) |
| MP4 里的音轨是 Opus,QuickTime / 访达预览可能放不出声音 | 成片其实有声音,换浏览器或 VLC 播放 |

## 6. 参考实现

`scripts/voice-demo-say.mjs` 用 macOS 自带的 `say` 把整条流程跑一遍,也是写自己的对接代码时的样板:

```bash
npm run voice:demo                       # 给演示片 voice-demo 配音,写进 public/voice/voice-demo/
npm run voice:demo -- --voice Tingting   # 指定声音(say -v '?' 列出可用的)
npm run voice:demo -- --dry-run          # 不合成,只验证流程
```

它做的事:

1. `npm run voice:script -- voice-demo --out script.json` 拿台词稿;
2. 每句把 `plain` 交给 TTS(这里是 `say -f 台词.txt -o 句.aiff`),用 `afinfo` 量时长、`afconvert` 转成 `.m4a`;
   每个标记:单独合成「标记前的文字」量时长,当作那个词在句中的时刻;
3. 写出实测 `measured.json`:

   ```json
   { "tangent-slope": { "slope-1": { "duration": 3.61, "marks": { "k": 2.1 }, "audio": "02-01-slope-1.m4a" } } }
   ```

   (`marks` 在这里是**相对这句开头**的秒数,排期时会换算成相对本段;`audio` 是写进时间表的文件名)
4. `npm run voice:layout -- script.json measured.json --out timing.json` 按第 4 节的规则排出时间表;
5. `npm run voice:check -- voice-demo timing.json` 校验。

换成真正的配音:只替换第 2 步(调你的 TTS 接口、或者读录音文件量时长),其余照抄。
