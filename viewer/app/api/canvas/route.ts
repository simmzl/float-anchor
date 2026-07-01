import { NextRequest, NextResponse } from 'next/server'
import { fetchSnapshot } from '@/lib/github'
import { findSharedCanvas } from '@/lib/share'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })
  try {
    const snap = await fetchSnapshot()
    const canvas = findSharedCanvas(snap, id)
    if (!canvas) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json({ canvas }, { headers: { 'Cache-Control': 'public, max-age=30' } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: '读取失败' }, { status: 502 })
  }
}
