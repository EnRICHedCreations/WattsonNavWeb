import { useEffect, useRef, useState } from 'react'
import { bearingDegrees, distanceMeters, type LatLng } from '../lib/geo/geoMath'

export interface LocationFix {
  location: LatLng
  bearingDegrees: number | null
}

const MIN_MOVEMENT_FOR_BEARING_METERS = 3.0

export function useGeolocation() {
  const [fix, setFix] = useState<LocationFix | null>(null)
  const [error, setError] = useState<string | null>(null)
  const previousLocationRef = useRef<LatLng | null>(null)
  const lastBearingRef = useRef<number | null>(null)

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported in this browser.')
      return
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const location: LatLng = { lat: position.coords.latitude, lon: position.coords.longitude }

        // Device-reported heading when available (typically once moving with
        // enough signal); otherwise derive from the last two fixes, but only
        // once actually moved enough for that to be meaningful — avoids the
        // bearing jittering while stationary.
        let bearing: number | null = position.coords.heading ?? null
        if (bearing == null) {
          const previous = previousLocationRef.current
          if (previous && distanceMeters(previous, location) >= MIN_MOVEMENT_FOR_BEARING_METERS) {
            bearing = bearingDegrees(previous, location)
          } else {
            bearing = lastBearingRef.current
          }
        }

        previousLocationRef.current = location
        lastBearingRef.current = bearing
        setFix({ location, bearingDegrees: bearing })
        setError(null)
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  return { fix, error }
}
