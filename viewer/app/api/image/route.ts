import { NextRequest } from 'next/server'
import { fetchSnapshot, fetchImage } from '@/lib/github'
import { findSharedCanvas, extractImageNames } from '@/lib/share'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || ''
  const name = req.nextUrl.searchParams.get('name') || ''
  if (!id || !name) return new Response('missing id/name', { status: 400 })
  try {
    const snap = await fetchSnapshot()
    const canvas = findSharedCanvas(snap, id)
    if (!canvas) return new Response('not found', { status: 404 })
    if (!extractImageNames(canvas).has(name)) return new Response('forbidden', { status: 404 })
    const { bytes, contentType } = await fetchImage(name)
    return new Response(bytes as BodyInit, { headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' } })
  } catch (e) {
    return new Response(String(e), { status: 502 })
  }
}
