#!/usr/bin/env python3
"""
Check that a 多音字 card's words and sentence read the character the way the
card is annotated.

Why this exists
---------------
A card for 背 annotated bèi was worded 背着 and had the sentence
「小鸭子背着小公鸡过河」, where 背 is bēi. A child learning the card then
reads the example the wrong way. One review found 50 such cards in grades
1–2 (少年 on a shǎo card, 教书 on jiào, 干净 on gàn, 喝水 on hè, …).

What is checked
---------------
For each card in the covered volumes (grades 1–5 by default), every word and
the sentence that contain the character. pypinyin gives the character's reading
in context; it must be the card's reading, tone included (背 bèi / bēi differ
only in tone). Not errors, so not reported:
  - 一 and 不, whose tone changes by rule (一个 yí, 不是 bú);
  - neutral tone on either side: the textbook writes it without a mark
    (哪 na), and a word may read a toned card neutrally (孩子 zi on 子 zǐ).

pypinyin only knows the commonest reading of a word, so it cannot see every
error (it reads 背着 as bèi, though 背着书包 is bēi); a person still has to
read new cards. This check keeps the known errors from coming back.

pypinyin is sometimes wrong in context (轻轻地 de, 谁 shuí/shéi, 一行 háng).
Those cards were checked by hand and are listed in KNOWN_OK with the reason,
keyed by lesson and character, so a new error on the same card is still
caught in a word not listed there.

Usage
-----
    python3 scripts/check_word_readings.py            # grades 1–2
    python3 scripts/check_word_readings.py --grades 1 2 3
Exit status 1 if any mismatch is found. Requires pypinyin (dev-only).
"""

import argparse
import glob
import json
import os
import sys

try:
    from pypinyin.contrib.tone_convert import to_normal
except ImportError:
    sys.exit("pypinyin required: pip install pypinyin")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_heteronyms import reading_of  # noqa: E402  (same Hanzi-run alignment)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (lesson, char, text) -> why the card is right although pypinyin disagrees.
KNOWN_OK = {
    ('1-1-23', '地', '轻轻地'): '结构助词 de',
    ('1-1-23', '地', '慢慢地'): '结构助词 de',
    ('1-1-23', '地', '雪人大肚子一挺，他顽皮地说：我就是冬天。'): '结构助词 de',
    ('1-1-34', '谁', '谁的'): '教材注 shuí，shéi 是口语读法',
    ('1-1-34', '谁', '谁的尾巴长？'): '教材注 shuí',
    ('1-1-34', '长', '很长'): '长短的长 cháng',
    ('1-1-34', '长', '猴子的尾巴长。'): '长短的长 cháng',
    ('1-2-12', '得', '天黑了，我得回家了。'): '必须 děi',
    ('2-1-5', '行', '一行'): '一行垂柳 háng',
    ('2-1-5', '行', '一行垂柳，一座花园。'): 'háng',
    ('2-1-10', '系', '哥哥，你系在门前树上的秋千呢？'): '系绳子 jì',
    ('2-1-25', '盛', '妈妈给我盛了一碗饭。'): 'chéng',
    ('2-1-8', '场', '秋季里，稻上场，谷像黄金粒粒香。'): '稻上场 cháng（识字表）',
    ('2-1-17', '钉', '四面墙上有许多小孔，里面钉着许多木架子。'): '钉着木架子 dìng（识字表）',
    ('2-2-22', '唉', '唉，真可惜'): '叹气的唉 ài（识字表）',
    ('2-2-22', '唉', '他叹了口气，说：“唉！”'): '叹气的唉 ài（识字表）',
    ('2-1-28', '似', '天似穹庐，笼盖四野。'): '古诗「天似穹庐」sì（识字表）',
    ('2-1-33', '扎', '他想了想，就扎了一只风筝。'): '扎风筝 zā（教材）',
    ('2-2-6', '曾', '我想—我们的祖先，可曾在这些大树上摘野果，掏鹊蛋？'): '可曾 céng',
    ('2-2-24', '行', '一行'): '一行白鹭 háng',
    ('2-2-24', '行', '两个黄鹂鸣翠柳，一行白鹭上青天。'): 'háng',
    ('2-2-24', '泊', '窗含西岭千秋雪，门泊东吴万里船。'): '停泊 bó',
    ('1-1-35', '只', '两只'): '两只 zhī（量词）',
    ('1-2-11', '种', '后来，这里种了好多树。'): '种树 zhòng',
    ('1-2-26', '闷', '发闷'): '空气闷 mēn（课文）',
    ('1-2-26', '闷', '水里闷得很。'): '空气闷 mēn（课文）',
    ('1-2-29', '背', '背着'): '背着书包 bēi',
    ('1-2-29', '背', '元元背着书包上学去。'): '背着书包 bēi',
    ('1-2-31', '结', '结果'): '结果子 jiē',
    ('1-2-31', '结', '开花结果'): '结果子 jiē',
    ('1-2-31', '结', '桃树上结了又大又红的桃子。'): '结果子 jiē',
    ('2-1-1', '教', '教课'): '教课、教我唱歌 jiāo',
    ('2-1-1', '教', '妈妈教我唱歌。'): '教课、教我唱歌 jiāo',
    ('2-1-1', '肚', '肚子'): '鸟肚子 dù',
    ('2-1-1', '肚', '孩子们在鸟肚子里睡上一觉。'): '鸟肚子 dù',
    ('2-1-2', '种', '课文介绍了哪几种植物？'): '几种 zhǒng',
    ('2-1-12', '撒', '撒下'): '撒种 sǎ',
    ('2-1-14', '尽', '白日依山尽，黄河入海流。'): '古诗 jìn',
    ('2-1-20', '号', '可是，寒号鸟已经在夜里冻死了。'): '寒号鸟 háo（教材）',
    ('2-1-25', '铺', '铺上'): '铺成 pū',
    ('2-1-25', '铺', '点，踩着凤凰花铺成的“地毯”，同傣族人民一起跳舞。'): '铺成 pū',
    ('2-1-28', '笼', '笼盖'): '笼盖 lǒng（教材）',
    ('2-1-28', '笼', '天似穹庐，笼盖四野。'): '笼盖 lǒng（教材）',
    ('2-2-18', '泡', '其实，那深水只是小狗撒的一泡尿。'): '一泡尿、眼泡 pāo',
    ('2-2-18', '茸', '鹿茸'): '鹿茸 róng',
    ('2-2-29', '扇', '大象扇着大耳朵。'): '扇耳朵 shān（动词）',
    ('2-2-31', '撒', '撒下'): '撒种 sǎ',
    ('2-2-36', '待', '待着'): '待着 dāi',
    ('2-2-36', '待', '待一会儿'): '待着 dāi',
    ('2-2-36', '待', '它就滚动起来，人在上面根本待不住。'): '待着 dāi',
    # Grades 3–5 (2026-10-29): the card is the book's 识字表 reading; pypinyin reads it otherwise.
    ('3-1-4', '挑', '知有儿童挑促织，夜深篱落一灯明。'): '挑促织 tiǎo（识字表）',
    ('3-1-8', '哦', '哦，是你'): '哦 ò（识字表）',
    ('3-1-8', '哦', '哦，是小猫啊。'): '哦 ò（识字表）',
    ('3-1-12', '冲', '冲着'): '冲着 chòng（识字表）',
    ('3-1-12', '冲', '马上就冒出了那么一条—冲着他摇尾巴，舔他的手。'): '冲着 chòng（识字表）',
    ('3-1-14', '处', '这件事要好好处理。'): '处理 chǔ（识字表）',
    ('3-1-17', '茸', '鹿茸'): '茸 róng（识字表）',
    ('3-1-17', '茸', '弟弟也假装打哈欠，把蒲公英的茸毛朝我脸上吹。'): '茸 róng（识字表）',
    ('3-1-28', '大', '大夫'): '大夫 dài（识字表）',
    ('3-1-28', '大', '白求恩大夫正在给伤员做手术。'): '大夫 dài（识字表）',
    ('3-2-11', '切', '切开'): '切 qiē（识字表）',
    ('3-2-11', '切', '切碎'): '切 qiē（识字表）',
    ('3-2-11', '切', '妈妈把西瓜切开了。'): '切 qiē（识字表）',
    ('3-2-13', '乘', '眼看就要撞上对面来的一乘轿子。'): '一乘轿子 shèng（识字表）',
    ('3-2-16', '查', '我打算问问长辈，再去查查相关的资料。'): '查 chá（识字表）',
    ('3-2-24', '瞭', '瞭哨'): '瞭 liào（识字表）',
    ('3-2-30', '脊', '屋脊'): '脊/旋 按识字表',
    ('3-2-30', '脊', '他一蹦就能蹦到屋脊那么高。'): '脊/旋 按识字表',
    ('3-2-30', '旋', '旋风'): '脊/旋 按识字表',
    ('3-2-30', '旋', '一阵旋风吹过。'): '脊/旋 按识字表',
    ('3-2-31', '涨', '县官鼻子都气歪了，脸涨得通红。'): '涨红 zhàng（识字表）',
    ('4-1-5', '框', '窗框'): '框 kuàng（识字表）',
    ('4-1-5', '框', '门框'): '框 kuàng（识字表）',
    ('4-1-5', '框', '她从窗台上牵了一根绳子到窗框的上端去。'): '框 kuàng（识字表）',
    ('4-1-6', '系', '绳子上系了许多铃铛。'): '系 jì（识字表）',
    ('4-1-11', '萎', '萎缩'): '萎 wěi（识字表）',
    ('4-1-11', '萎', '爬山虎的脚要是没触着墙，不几天就萎了。'): '萎 wěi（识字表）',
    ('4-1-20', '吁', '吁哩哩'): '吁 yū（识字表）',
    ('4-1-20', '吁', '这时，有一个顽皮的孩子故意要引它们来，就吁哩哩哩地叫了一声。'): '吁 yū（识字表）',
    ('4-1-21', '撇', '他撇了撇嘴。'): '撇嘴 piě（识字表）',
    ('4-1-30', '纪', '纪昌'): '纪昌 jǐ（识字表）',
    ('4-1-30', '纪', '纪昌向飞卫学射箭。'): '纪昌 jǐ（识字表）',
    ('4-2-3', '卜', '卜落'): '卜落 bǔ（识字表）',
    ('4-2-3', '卜', '你会看见雨脚在那里卜落卜落跳。'): '卜落 bǔ（识字表）',
    ('4-2-5', '澎', '澎湃'): '澎湃 péng（识字表）',
    ('4-2-5', '澎', '澎湃的波涛把海里的泥沙卷到岸边。'): '澎湃 péng（识字表）',
    ('4-2-17', '吭', '甚至篱笆外有人走路，它也要引吭大叫。'): '吭/颇 按识字表',
    ('4-2-17', '颇', '颇为'): '吭/颇 按识字表',
    ('4-2-17', '颇', '颇多'): '吭/颇 按识字表',
    ('4-2-17', '颇', '大模大样的，颇像京剧里的净角出场。'): '吭/颇 按识字表',
    ('4-2-19', '荷', '太阳好像负着重荷似的一步一步，慢慢地努力上升。'): '重荷 hè（识字表）',
    ('4-2-30', '拽', '拉拽'): '拽/冲 按识字表',
    ('4-2-30', '拽', '拽住'): '拽/冲 按识字表',
    ('4-2-30', '拽', '可是胳膊给奶奶拽住了。'): '拽/冲 按识字表',
    ('4-2-30', '冲', '冲着'): '拽/冲 按识字表',
    ('4-2-30', '冲', '小狗冲着我直叫。'): '拽/冲 按识字表',
    ('5-1-15', '哼', '哼，我不信'): '哼 hng（识字表）',
    ('5-1-15', '哼', '哼！我才不怕你呢。'): '哼 hng（识字表）',
    ('5-1-17', '杈', '松鼠的窝通常搭在树枝分杈的地方，又干净又暖和。'): '分杈 chà（识字表）',
    ('5-1-21', '聒', '聒噪'): '聒 guō（识字表）',
    ('5-1-21', '聒', '聒耳'): '聒 guō（识字表）',
    ('5-1-21', '聒', '风一更，雪一更，聒碎乡心梦不成。'): '聒 guō（识字表）',
    ('5-1-25', '煞', '虽然因为作者要凑成三十六天罡七十二地煞。'): '煞 shà（识字表）',
    ('5-1-26', '甸', '草甸'): '草甸 diàn（识字表）',
    ('5-2-1', '供', '供耕织'): '供 gòng（识字表）',
    ('5-2-1', '供', '童孙未解供耕织，也傍桑阴学种瓜。'): '供 gòng（识字表）',
    ('5-2-3', '燕', '燕园'): '燕园 yān（识字表）',
    ('5-2-3', '燕', '我现在年事已高，住的朗润园是燕园胜地。'): '燕园 yān（识字表）',
    ('5-2-6', '绰', '绰起'): '按识字表',
    ('5-2-6', '绰', '绰了梢棒，立起身来道：“我却又不曾醉。”'): '按识字表',
    ('5-2-6', '肋', '两肋'): '按识字表',
    ('5-2-6', '肋', '便把毡笠儿背在脊梁上，将梢棒绾在肋下。'): '按识字表',
    ('5-2-6', '呵', '呵呀'): '按识字表',
    ('5-2-6', '呵', '武松见了，叫声：“呵呀！”'): '按识字表',
    ('5-2-6', '哮', '咆哮'): '按识字表',
    ('5-2-6', '哮', '哮喘'): '按识字表',
    ('5-2-6', '哮', '那大虫咆哮，性发起来，翻身又只一扑。'): '按识字表',
    ('5-2-7', '呵', '好呵'): '呵 a（识字表）',
    ('5-2-7', '呵', '这里真好呵！'): '呵 a（识字表）',
    ('5-2-8', '豁', '只听“豁喇喇”一阵响，登时线尽。'): '豁/喇 按识字表',
    ('5-2-8', '喇', '豁喇喇'): '豁/喇 按识字表',
    ('5-2-8', '喇', '只听“豁喇喇”一阵响，登时线尽。'): '豁/喇 按识字表',
    ('5-2-9', '裳', '初闻涕泪满衣裳。'): '衣裳 cháng（识字表，古诗）',
    ('5-2-12', '吓', '害我性命，却把大虫吓我。'): '吓 hè（识字表）',
    ('5-2-14', '怔', '他怔怔地伫立了足有一分钟。'): '怔 zhèng（识字表）',
    ('5-2-15', '夫', '夫不可陷之盾'): '夫 fú（识字表，文言发语词）',
    ('5-2-15', '夫', '夫不可陷之盾与无不陷之矛，不可同世而立。'): '夫 fú（识字表，文言发语词）',
    ('5-2-22', '拧', '拧开'): '拧 nǐng（识字表）',
    ('5-2-22', '拧', '打电话、扳枪机必须请他，打算盘、拧螺丝、解纽扣等。'): '拧 nǐng（识字表）',
}

# Cards where the annotation and its own words disagree, and it is not yet
# known which is wrong. Kept apart from KNOWN_OK so they stay visible: the
# check prints them as a reminder, and they should be fixed, not allowed.
TO_CONFIRM = {
}


TONE_MARKS = 'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ'
SANDHI = {'一', '不'}


def differs(char, card, got):
    """True if `got` (the reading in a word) is a different reading from the card's."""
    if to_normal(got) != to_normal(card):
        return True                       # another syllable: 少年 shào on shǎo
    if char in SANDHI:
        return False
    neutral = lambda p: not any(c in TONE_MARKS for c in p)  # noqa: E731
    if neutral(card) or neutral(got):
        return False
    return got != card                    # same syllable, another tone: 背包 bēi on bèi


def check(grades):
    """
    List the mismatches in the given grades.

    Returns a list of (lesson_id, char, card_pinyin, text, reading_in_text).
    """
    bad = []
    for g in grades:
        for path in sorted(glob.glob(os.path.join(REPO_ROOT, 'data', f'grade{g}-semester*.json'))):
            data = json.load(open(path, encoding='utf-8'))
            for lesson in data['lessons']:
                for entry in lesson['chars']:
                    ch, want = entry['char'], (entry.get('pinyin') or '').strip()
                    if not want:
                        continue
                    texts = [w for w in (entry.get('words') or []) if isinstance(w, str)]
                    if isinstance(entry.get('sentence'), str):
                        texts.append(entry['sentence'])
                    for text in texts:
                        if ch not in text or (lesson['id'], ch, text) in KNOWN_OK or (lesson['id'], ch, text) in TO_CONFIRM:
                            continue
                        got = reading_of(text, ch)
                        if got and differs(ch, want, got):
                            bad.append((lesson['id'], ch, want, text, got))
    return bad


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--grades', type=int, nargs='+', default=[1, 2, 3, 4, 5],
                    help='grades to check (default: 1–5, the grades whose book has a 识字表)')
    args = ap.parse_args()
    bad = check(args.grades)
    if not bad:
        print(f'✅ 多音字组词和例句的读音和卡片注音一致（{"、".join(map(str, args.grades))} 年级）')
        cards = sorted({(k[0], k[1]) for k in TO_CONFIRM if int(k[0].split('-')[0]) in args.grades})
        if cards:
            print(f'  ⚠️ 还有 {len(cards)} 张卡片待对照课本：' + '、'.join(f'{l} {c}' for l, c in cards))
        return 0
    print(f'❌ {len(bad)} 处组词或例句里，这个字的读音和卡片注音不同：')
    for lid, ch, want, text, got in bad:
        print(f'  {lid} {ch}（卡片 {want}）「{text}」读 {got}')
    print('  修法：换一个读这个音的词或例句；工具读错的，人工确认后写进 KNOWN_OK 并写明理由')
    return 1


if __name__ == '__main__':
    sys.exit(main())
