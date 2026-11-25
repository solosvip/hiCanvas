import { getMediaTarget } from '../media-target.js'
import { placeMedia } from '../media-placement.js'

export function insertHtml(store, { args = {}, html }) {
  const { anchor } = getMediaTarget({ store: Object.fromEntries(store.allRecords().map(record => [record.id, record])) }, args)
  const film = anchor?.meta?.cowartAiFilmHolder || anchor?.meta?.cowartFilm || args.shapeMeta?.cowartFilm
  const meta = { cowartHtmlDraft: true, cowartHtmlDraftAssetUrl: html.assetUrl, cowartHtmlDraftContentHash: html.contentHash, ...args.shapeMeta }
  if (film) Object.assign(meta, { cowartFilm: true, cowartFilmDuration: anchor?.meta?.cowartFilmDuration ?? args.shapeMeta?.cowartFilmDuration ?? 15, cowartFilmStyle: anchor?.meta?.cowartFilmStyle ?? args.shapeMeta?.cowartFilmStyle ?? 'product-launch', cowartFilmMuted: anchor?.meta?.cowartFilmMuted ?? false })
  return placeMedia(store, args, { type: 'embed', props: { w: 1024, h: 576, url: html.url }, meta })
}
