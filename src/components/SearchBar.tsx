import type { GeocodeResult } from '../lib/domain'

interface SearchBarProps {
  query: string
  results: GeocodeResult[]
  onQueryChange: (query: string) => void
  onResultSelected: (result: GeocodeResult) => void
  placeholder?: string
}

export default function SearchBar({ query, results, onQueryChange, onResultSelected, placeholder = 'Where to?' }: SearchBarProps) {
  return (
    <div className="search-bar">
      <input
        className="search-input"
        type="text"
        value={query}
        placeholder={placeholder}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {results.length > 0 && (
        <div className="search-results">
          {results.map((result) => (
            <button
              key={`${result.label}-${result.location.lat}-${result.location.lon}`}
              className="search-result-item"
              onClick={() => onResultSelected(result)}
            >
              {result.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
