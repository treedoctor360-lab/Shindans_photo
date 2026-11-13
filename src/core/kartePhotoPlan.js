// カルテに貼る写真の割り当て（撮った順の写真の並びを、木ごとに区切る）
//  現場の撮り方：木ごとに、1枚目は樹木番号が分かる写真（番号の写真）。次の番号の写真の手前までがその木の写真。
//  - 番号の写真は人が選ぶ（photo.number）。番号の写真の順に、木の並びの順で1本ずつ当てる。
//    番号の写真に木を選んであれば（photo.treeKey）その木から。その後ろはまた順に当てる
//  - 全景の枠（設定 karte.photos の full の枠）には、その木の最初の縦の写真を自動で入れる（選び直せる）
//  - ほかの枠は人が選ぶ。見出しは木ごと・枠ごとに覚える
// 画面・保存に依存しない（保存は src/store/kphotos.js）。

// 撮った順（撮影日時、同じなら名前）に並べる。外した写真は除く
export const sortPhotos = (photos) =>
  photos.filter((p) => !p.removed).sort((a, b) => String(a.shotAt || '').localeCompare(String(b.shotAt || '')) || String(a.name || '').localeCompare(String(b.name || ''), 'ja', { numeric: true }));

// 木ごとの区切り。trees：まとまりの木（並び順）[{ key, treeNo }]
//  返す形：{ before: 最初の番号の写真より前の写真, segments: [{ number: 番号の写真, treeKey（当てた木。足りなければ ''）, photos: その木の写真（番号の写真を除く） }] }
export function segmentsOf(photos, trees) {
  const list = sortPhotos(photos);
  const before = [];
  const segments = [];
  let next = 0; // 次に当てる木の位置
  for (const p of list) {
    if (p.number) {
      let at = p.treeKey ? trees.findIndex((t) => t.key === p.treeKey) : -1;
      if (at < 0) at = next;
      segments.push({ number: p, treeKey: trees[at]?.key || '', photos: [] });
      next = at + 1;
    } else if (segments.length) segments.at(-1).photos.push(p);
    else before.push(p);
  }
  return { before, segments };
}

// 縦の写真か
export const isPortrait = (p) => p.h > p.w;

// 1本の木の、枠ごとの写真。slots：設定 karte.photos.slots。pick：その木の選んだ内容 { [枠の key]: { id, caption } }
//  全景の枠（full）：選んでいなければ最初の縦の写真。「入れない」を選んだ（id が ''）なら空
//  返す形：[{ slot, photo（なければ null）, caption, auto（自動で入れたか） }]
export function slotPhotos(segPhotos, slots, pick = {}) {
  const byId = new Map(segPhotos.map((p) => [p.id, p]));
  const used = new Set(Object.values(pick).map((x) => x?.id).filter(Boolean));
  return slots.map((slot) => {
    const sel = pick[slot.key];
    if (sel && sel.id !== undefined) {
      const photo = sel.id ? byId.get(sel.id) || null : null;
      return { slot, photo, caption: sel.caption || '', auto: false };
    }
    if (slot.full) {
      const photo = segPhotos.find((p) => isPortrait(p) && !used.has(p.id)) || null;
      return { slot, photo, caption: '', auto: !!photo };
    }
    return { slot, photo: null, caption: sel?.caption || '', auto: false };
  });
}

// 写真を押したとき：選んであれば外す。選んでなければ、空いている最初の枠（全景の枠を除く）に入れる
//  返す形：新しい pick（空いている枠がなければ元のまま）
export function togglePick(pick = {}, slots, segPhotos, photoId) {
  const cur = slotPhotos(segPhotos, slots, pick);
  const hit = cur.find((x) => x.photo?.id === photoId);
  if (hit) return { ...pick, [hit.slot.key]: hit.slot.full ? { id: '' } : { caption: '' } }; // 全景は「入れない」を覚える
  const free = cur.find((x) => !x.slot.full && !x.photo);
  if (!free) return pick;
  return { ...pick, [free.slot.key]: { id: photoId, caption: pick[free.slot.key]?.caption || '' } };
}

// 全景にする（ほかの枠に入っていれば、そこからは外す）
export function setFull(pick = {}, slots, photoId) {
  const full = slots.find((s) => s.full);
  if (!full) return pick;
  const next = { ...pick };
  for (const s of slots) if (!s.full && next[s.key]?.id === photoId) next[s.key] = { caption: '' };
  next[full.key] = { id: photoId };
  return next;
}
