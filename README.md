# ボス戦マンカラ

ガラス玉で戦う、マンカラRPG。スマホのブラウザで遊べます（縦向き）。

**遊ぶ：** このリポジトリの GitHub Pages のページを開いてください。

## あそびかた

1. **白い穴**をタップすると、玉が流れる道が光ります。もう一度タップすると、玉を1個ずつ流します。
2. **自分のゴール**に入った玉の色のキャラが攻撃します。最後の1個がゴールに入れば、もう1回。金の輪の**強化玉**は1.5倍。
3. 敵も黒い穴から玉を流してきます。**あと○**が0になると、攻撃や盤への技（こおらせる・塗りかえ・さらう・逆まわり・色を変える）。
4. キャラの顔をタップでスキル。5階のボス「万華鏡の魔女」をたおせばクリア。

## しくみ

- 素の JavaScript と canvas（ビルドなし）
- ガラス玉は [three.js](https://threejs.org/) の物理ベースのガラスで、起動時に描いています
- BGM・効果音は Web Audio でその場で合成
- 文字：[Dela Gothic One](https://fonts.google.com/specimen/Dela+Gothic+One)、[M PLUS Rounded 1c](https://fonts.google.com/specimen/M+PLUS+Rounded+1c)（Google Fonts）
- キャラクターと背景の絵は、画像生成 AI で作った仮のものです

## ファイル

- `js/data.js` … 属性・キャラ・敵・盤の形・ステージ（数値はここで調整）
- `js/rules.js` … 盤と1手のルール
- `js/battle.js` … 番の流れ・攻撃・敵・スキル
- `js/view.js` … 画面と演出
- `js/beads3d.js` … 3Dのガラス玉
- `js/audio.js` / `js/music.js` … 効果音と BGM
