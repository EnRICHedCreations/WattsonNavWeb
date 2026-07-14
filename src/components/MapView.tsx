import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { LatLng } from '../lib/geo/geoMath'
import type { ChargePoint, PitstopPlan } from '../lib/domain'

const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const INITIAL_ZOOM = 14
const NAV_ZOOM = 17
const CAMERA_EASE_MS = 800

const ROUTE_SOURCE_ID = 'route-source'
const ROUTE_LAYER_ID = 'route-layer'
const PITSTOP_SOURCE_ID = 'pitstop-source'
const PITSTOP_LAYER_ID = 'pitstop-layer'

function createPuckElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'puck-marker'
  el.innerHTML = `
    <svg viewBox="0 0 32 32" width="32" height="32">
      <path d="M16 3 L26 26 L16 21 L6 26 Z" fill="#FFFFFF" />
      <path d="M16 6 L23 23 L16 19.5 L9 23 Z" fill="#4FC3F7" />
    </svg>
  `
  return el
}

interface MapViewProps {
  liveLocation: LatLng | null
  puckBearingDegrees: number | null
  pitstopPlan: PitstopPlan | null
  isNavigating: boolean
  onPitstopTap: (chargePoint: ChargePoint) => void
}

export default function MapView({
  liveLocation,
  puckBearingDegrees,
  pitstopPlan,
  isNavigating,
  onPitstopTap,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const styleLoadedRef = useRef(false)
  const puckMarkerRef = useRef<maplibregl.Marker | null>(null)
  const hasCenteredInitiallyRef = useRef(false)
  const onPitstopTapRef = useRef(onPitstopTap)
  onPitstopTapRef.current = onPitstopTap

  const [followMode, setFollowMode] = useState(true)
  const [, forceStyleReady] = useState(0)

  // Map + puck marker setup — runs once.
  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [0, 0],
      zoom: 2,
    })
    mapRef.current = map

    map.on('load', () => {
      styleLoadedRef.current = true
      forceStyleReady((n) => n + 1)
    })

    map.on('dragstart', () => setFollowMode(false))
    map.on('wheel', () => setFollowMode(false))
    map.on('touchstart', () => setFollowMode(false))

    const marker = new maplibregl.Marker({ element: createPuckElement(), rotationAlignment: 'map' })
    puckMarkerRef.current = marker

    return () => {
      marker.remove()
      map.remove()
      mapRef.current = null
      puckMarkerRef.current = null
      styleLoadedRef.current = false
    }
  }, [])

  // Route line + pitstop markers.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleLoadedRef.current) return

    const routeGeojson: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: pitstopPlan ? pitstopPlan.route.points.map((p) => [p.lon, p.lat]) : [],
      },
    }

    const existingRouteSource = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (existingRouteSource) {
      existingRouteSource.setData(routeGeojson)
    } else {
      map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: routeGeojson })
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#00E676', 'line-width': 4 },
      })
    }

    const pitstopFeatures: GeoJSON.Feature<GeoJSON.Point>[] = (pitstopPlan?.pitstops ?? []).map((p) => ({
      type: 'Feature',
      properties: { chargePointId: p.chargePoint.id },
      geometry: { type: 'Point', coordinates: [p.chargePoint.location.lon, p.chargePoint.location.lat] },
    }))
    const pitstopGeojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: 'FeatureCollection',
      features: pitstopFeatures,
    }

    const existingPitstopSource = map.getSource(PITSTOP_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (existingPitstopSource) {
      existingPitstopSource.setData(pitstopGeojson)
    } else {
      map.addSource(PITSTOP_SOURCE_ID, { type: 'geojson', data: pitstopGeojson })
      map.addLayer({
        id: PITSTOP_LAYER_ID,
        type: 'circle',
        source: PITSTOP_SOURCE_ID,
        paint: {
          'circle-color': '#FFB300',
          'circle-radius': 10,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#121316',
        },
      })
      map.on('click', PITSTOP_LAYER_ID, (e) => {
        const chargePointId = e.features?.[0]?.properties?.chargePointId as string | undefined
        if (!chargePointId) return
        const match = pitstopPlan?.pitstops.find((p) => p.chargePoint.id === chargePointId)
        if (match) onPitstopTapRef.current(match.chargePoint)
      })
      map.on('mouseenter', PITSTOP_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', PITSTOP_LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
      })
    }
  }, [pitstopPlan])

  // Puck position/rotation + camera follow.
  useEffect(() => {
    const map = mapRef.current
    const marker = puckMarkerRef.current
    if (!map || !marker || !liveLocation) return

    marker.setLngLat([liveLocation.lon, liveLocation.lat])
    if (puckBearingDegrees != null) {
      marker.setRotation(puckBearingDegrees)
    }
    if (!marker.getElement().isConnected) {
      marker.addTo(map)
    }

    if (!hasCenteredInitiallyRef.current) {
      map.jumpTo({ center: [liveLocation.lon, liveLocation.lat], zoom: INITIAL_ZOOM })
      hasCenteredInitiallyRef.current = true
    } else if (isNavigating && followMode) {
      map.easeTo({ center: [liveLocation.lon, liveLocation.lat], zoom: NAV_ZOOM, duration: CAMERA_EASE_MS })
    }
  }, [liveLocation, puckBearingDegrees, isNavigating, followMode])

  const handleRecenter = () => {
    setFollowMode(true)
    const map = mapRef.current
    if (map && liveLocation) {
      map.easeTo({ center: [liveLocation.lon, liveLocation.lat], zoom: NAV_ZOOM, duration: CAMERA_EASE_MS })
    }
  }

  return (
    <div className="map-container">
      <div ref={containerRef} className="map-view" />

      {isNavigating && !followMode && liveLocation && (
        <button className="recenter-button" onClick={handleRecenter}>
          Recenter
        </button>
      )}
    </div>
  )
}
